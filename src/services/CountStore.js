import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'

export const COUNT_SCHEMA_VERSION = 1
export const COUNT_DATA_PATH = path.join('data', 'count.json')
export const COUNT_PERIODS = ['total', 'daily', 'weekly', 'monthly', 'yearly']
export const COUNT_ITEMS = ['total', 'visits', 'journeys', 'videos']

const DAY_MS = 24 * 60 * 60 * 1000
const PERIOD_MAPS = ['daily', 'weekly', 'monthly', 'yearly']
const EVENTS = {
    visit:  {item: 'visits'},
    journey: {item: 'journeys'},
    'video/draft': {item: 'videos', quality: 'draft'},
    'video/hq':    {item: 'videos', quality: 'hq'},
}

/**
 * Error raised when a count API path or persisted count value is invalid.
 */
export class CountValidationError extends Error {
    /**
     * Create a count validation error.
     *
     * @param {string} message Human-readable validation message.
     */
    constructor(message) {
        super(message)
        this.name = 'CountValidationError'
    }
}

/**
 * Check whether a value is a non-null plain object.
 *
 * @param {*} value Value to inspect.
 * @returns {boolean} Whether the value can represent a JSON object.
 */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Create an empty counter row with independent video counters.
 *
 * @returns {{visits: number, journeys: number, videos: {draft: number, hq: number}}} Empty row.
 */
export const createEmptyCounter = () => ({
    visits:  0,
    journeys: 0,
    videos:  {
        draft: 0,
        hq:    0,
    },
})

/**
 * Create an empty aggregate snapshot.
 *
 * @param {string|null} updatedAt Last update timestamp, if known.
 * @returns {object} Empty count snapshot.
 */
export const createEmptySnapshot = (updatedAt = null) => ({
    schemaVersion: COUNT_SCHEMA_VERSION,
    updatedAt,
    total:        createEmptyCounter(),
    daily:        {},
    weekly:       {},
    monthly:      {},
    yearly:       {},
})

/**
 * Clone a JSON-compatible count value before exposing it to a caller.
 *
 * @param {*} value JSON-compatible value to clone.
 * @returns {*} Independent clone.
 */
const cloneValue = (value) => structuredClone(value)

/**
 * Convert an input value to a valid Date without changing its timezone semantics.
 *
 * @param {Date|string|number} value Date-like input.
 * @returns {Date} Valid Date instance.
 * @throws {CountValidationError} If the input is not a valid date.
 */
const toDate = (value) => {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
    if (!Number.isFinite(date.getTime())) {
        throw new CountValidationError('Invalid UTC date')
    }
    return date
}

/**
 * Format a number with a fixed number of decimal digits.
 *
 * @param {number} value Number to format.
 * @param {number} length Required output length.
 * @returns {string} Zero-padded number.
 */
const pad = (value, length) => `${value}`.padStart(length, '0')

/**
 * Calculate the ISO week year and week number for a UTC date.
 *
 * @param {Date} date Valid date.
 * @returns {{year: number, week: number}} ISO week components.
 */
const getIsoWeek = (date) => {
    const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    const day = utcDate.getUTCDay() || 7
    utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day)
    const year = utcDate.getUTCFullYear()
    const firstThursday = new Date(Date.UTC(year, 0, 4))
    const week = 1 + Math.round((utcDate.getTime() - firstThursday.getTime()) / DAY_MS / 7)

    return {year, week}
}

/**
 * Normalize one persisted scalar counter value.
 *
 * @param {*} candidate Candidate scalar value.
 * @returns {number|null} Safe non-negative integer, or null for invalid data.
 */
const readCounterNumber = (candidate) => {
    if (candidate === undefined) {
        return 0
    }
    return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : null
}

/**
 * Resolve all requested UTC period keys for a date.
 *
 * @param {Date|string|number} value Date-like input.
 * @returns {{daily: string, weekly: string, monthly: string, yearly: string}} UTC keys.
 */
export const getUtcPeriodKeys = (value) => {
    const date = toDate(value)
    const isoWeek = getIsoWeek(date)

    return {
        daily:   `${pad(date.getUTCDate(), 2)}-${pad(date.getUTCMonth() + 1, 2)}-${date.getUTCFullYear()}`,
        weekly:  `${isoWeek.year}-W${pad(isoWeek.week, 2)}`,
        monthly: `${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCFullYear() % 100, 2)}`,
        yearly:  `${date.getUTCFullYear()}`,
    }
}

/**
 * Validate a persisted counter value and normalize omitted counters to zero.
 *
 * @param {*} value Candidate counter row.
 * @returns {object|null} Normalized row, or null for invalid data.
 */
const normalizeCounter = (value) => {
    if (!isObject(value)) {
        return null
    }

    const visits = readCounterNumber(value.visits)
    const journeys = readCounterNumber(value.journeys)
    const videos = isObject(value.videos) ? value.videos : {}
    const draft = readCounterNumber(videos.draft)
    const hq = readCounterNumber(videos.hq)

    if ([visits, journeys, draft, hq].some(candidate => candidate === null)) {
        return null
    }

    return {
        visits,
        journeys,
        videos: {draft, hq},
    }
}

/**
 * Validate a persisted period key.
 *
 * @param {string} period Period map name.
 * @param {string} key Candidate period key.
 * @returns {boolean} Whether the key has the required format.
 */
const isPeriodKey = (period, key) => {
    if (typeof key !== 'string') {
        return false
    }

    if (period === 'daily') {
        const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(key)
        if (!match || Number(match[2]) < 1 || Number(match[2]) > 12 || Number(match[1]) < 1 || Number(match[1]) > 31) {
            return false
        }
        const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])))
        return date.getUTCFullYear() === Number(match[3]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[1])
    }

    if (period === 'weekly') {
        return /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(key)
    }

    if (period === 'monthly') {
        return /^(?:0[1-9]|1[0-2])-\d{2}$/.test(key)
    }

    if (period === 'yearly') {
        return /^\d{4}$/.test(key)
    }

    return false
}

/**
 * Normalize one persisted historical period map.
 *
 * @param {*} value Candidate period map.
 * @param {string} period Period map name.
 * @returns {object|null} Normalized map, or null for invalid data.
 */
const normalizePeriodMap = (value, period) => {
    if (!isObject(value)) {
        return null
    }

    const normalized = {}
    for (const [key, row] of Object.entries(value)) {
        if (!isPeriodKey(period, key)) {
            return null
        }
        const counter = normalizeCounter(row)
        if (!counter) {
            return null
        }
        normalized[key] = counter
    }
    return normalized
}

/**
 * Validate and normalize a count snapshot loaded from disk.
 *
 * Unknown properties are discarded so the in-memory and persisted model cannot
 * accidentally retain event history or visitor identity data.
 *
 * @param {*} value Candidate snapshot.
 * @returns {object|null} Safe normalized snapshot, or null for corrupt data.
 */
export const normalizeSnapshot = (value) => {
    if (!isObject(value) || (value.schemaVersion !== undefined && value.schemaVersion !== COUNT_SCHEMA_VERSION)) {
        return null
    }

    const total = normalizeCounter(value.total)
    if (!total) {
        return null
    }

    let updatedAt = null
    if (value.updatedAt !== undefined && value.updatedAt !== null) {
        if (typeof value.updatedAt !== 'string' || !Number.isFinite(new Date(value.updatedAt).getTime())) {
            return null
        }
        updatedAt = value.updatedAt
    }

    const normalized = createEmptySnapshot(updatedAt)
    normalized.total = total
    for (const period of PERIOD_MAPS) {
        const periodMap = normalizePeriodMap(value[period] ?? {}, period)
        if (!periodMap) {
            return null
        }
        normalized[period] = periodMap
    }

    return normalized
}

/**
 * Increment one event in a counter row.
 *
 * @param {object} counter Counter row to mutate.
 * @param {{item: string, quality?: string}} event Event descriptor.
 * @returns {void}
 */
const incrementCounter = (counter, event) => {
    if (event.item === 'videos') {
        counter.videos[event.quality] += 1
        return
    }
    counter[event.item] += 1
}

/**
 * Create and manage the aggregate count snapshot for one backend process.
 */
export class CountStore {
    /**
     * Create a count store.
     *
     * @param {object} options Store configuration.
     * @param {string} [options.backendHome] Backend home directory.
     * @param {string} [options.filePath] Explicit count file path.
     * @param {() => Date} [options.clock] UTC clock used for period resolution.
     * @param {boolean} [options.autoPersist=true] Schedule daily persistence.
     * @param {boolean} [options.registerShutdownHandlers=false] Persist on SIGINT/SIGTERM.
     */
    constructor({
                    backendHome = process.env.LGS1920_BACKEND_HOME || process.cwd(),
                    filePath = null,
                    clock = () => new Date(),
                    autoPersist = true,
                    registerShutdownHandlers = false,
                } = {}) {
        this.backendHome = path.resolve(backendHome)
        this.filePath = path.resolve(filePath ?? path.join(this.backendHome, COUNT_DATA_PATH))
        this.dataDirectory = path.dirname(this.filePath)
        this.clock = clock
        this.snapshot = createEmptySnapshot()
        this.queueTail = Promise.resolve()
        this.closed = false
        this.persistenceTimer = null
        this.shutdownHandlers = null
        this.closePromise = null
        this.ready = this.load()

        if (autoPersist) {
            this.scheduleDailyPersistence()
        }
        if (registerShutdownHandlers) {
            this.registerShutdownHandlers()
        }
    }

    /**
     * Load the count snapshot and recover to an empty snapshot on disk errors.
     *
     * @returns {Promise<void>} Resolves when startup state is available.
     */
    load = async () => {
        await mkdir(this.dataDirectory, {recursive: true})

        try {
            const content = await readFile(this.filePath, 'utf8')
            const loaded = normalizeSnapshot(JSON.parse(content))
            if (!loaded) {
                throw new CountValidationError('Invalid count snapshot')
            }
            this.snapshot = loaded
        }
        catch {
            this.snapshot = createEmptySnapshot()
            await this.writeSnapshot().catch(() => undefined)
        }
    }

    /**
     * Queue an operation behind every earlier count mutation.
     *
     * @param {() => Promise<*>} operation Operation to serialize.
     * @returns {Promise<*>} Operation result.
     */
    enqueue = (operation) => {
        const task = this.queueTail.then(() => this.ready).then(operation)
        this.queueTail = task.catch(() => undefined)
        return task
    }

    /**
     * Schedule the next daily atomic persistence at the next UTC midnight.
     *
     * @returns {void}
     */
    scheduleDailyPersistence = () => {
        const now = toDate(this.clock())
        const nextMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
        const delay = Math.max(nextMidnight.getTime() - now.getTime(), 1)

        this.persistenceTimer = setTimeout(async () => {
            await this.saveNow().catch(() => undefined)
            if (!this.closed) {
                this.scheduleDailyPersistence()
            }
        }, delay)
        this.persistenceTimer.unref?.()
    }

    /**
     * Atomically write the current snapshot to the configured JSON file.
     *
     * @returns {Promise<void>} Resolves after the replacement is complete.
     */
    writeSnapshot = async () => {
        await mkdir(this.dataDirectory, {recursive: true})
        const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
        let fileHandle = null

        try {
            fileHandle = await open(temporaryPath, 'w')
            await fileHandle.writeFile(JSON.stringify(this.snapshot), 'utf8')
            await fileHandle.sync()
            await fileHandle.close()
            fileHandle = null
            await rename(temporaryPath, this.filePath)
        }
        finally {
            if (fileHandle) {
                await fileHandle.close().catch(() => undefined)
            }
            await rm(temporaryPath, {force: true}).catch(() => undefined)
        }
    }

    /**
     * Persist the current in-memory snapshot after earlier queued mutations.
     *
     * @returns {Promise<void>} Resolves after persistence completes.
     */
    saveNow = () => this.enqueue(async () => {
        await this.writeSnapshot()
    })

    /**
     * Record one accepted event in every required aggregate period.
     *
     * @param {'visit'|'journey'|'video/draft'|'video/hq'} eventType Event name.
     * @param {Date|string|number} [at] Optional event timestamp for deterministic callers.
     * @returns {Promise<object>} Updated aggregate values.
     */
    recordEvent = (eventType, at = null) => {
        const event = EVENTS[eventType]
        if (!event) {
            throw new CountValidationError('Unsupported count event')
        }
        if (this.closed) {
            throw new Error('Count store is closed')
        }

        return this.enqueue(async () => {
            const eventDate = toDate(at ?? this.clock())
            const keys = getUtcPeriodKeys(eventDate)
            const periodRows = {total: this.snapshot.total}

            for (const period of PERIOD_MAPS) {
                const key = keys[period]
                this.snapshot[period][key] ??= createEmptyCounter()
                periodRows[period] = this.snapshot[period][key]
            }

            for (const row of Object.values(periodRows)) {
                incrementCounter(row, event)
            }

            this.snapshot.updatedAt = eventDate.toISOString()

            return {
                success:   true,
                event:     eventType,
                updatedAt: this.snapshot.updatedAt,
                counts:    cloneValue(periodRows),
            }
        })
    }

    /**
     * Read a detached copy of the full aggregate snapshot.
     *
     * @returns {Promise<object>} Current snapshot.
     */
    getSnapshot = async () => {
        await this.ready
        return cloneValue(this.snapshot)
    }

    /**
     * Resolve a period key without creating or changing a stored row.
     *
     * @param {'total'|'daily'|'weekly'|'monthly'|'yearly'} period Period name.
     * @param {string|null} key Explicit period key.
     * @returns {string} Stored lookup key.
     */
    resolvePeriodKey = (period, key = null) => {
        if (!COUNT_PERIODS.includes(period)) {
            throw new CountValidationError('Unsupported count period')
        }
        if (period === 'total') {
            if (key && key !== 'total') {
                throw new CountValidationError('Invalid total period key')
            }
            return 'total'
        }

        const resolvedKey = key ?? getUtcPeriodKeys(this.clock())[period]
        if (!isPeriodKey(period, resolvedKey)) {
            throw new CountValidationError('Invalid count period key')
        }
        return resolvedKey
    }

    /**
     * Read a detached aggregate row without creating a missing period.
     *
     * @param {'total'|'daily'|'weekly'|'monthly'|'yearly'} period Period name.
     * @param {string|null} [key] Explicit period key.
     * @returns {Promise<object>} Stored row or zero counters.
     */
    getPeriod = async (period, key = null) => {
        await this.ready
        const resolvedKey = this.resolvePeriodKey(period, key)
        const row = period === 'total' ? this.snapshot.total : this.snapshot[period][resolvedKey]
        return cloneValue(row ?? createEmptyCounter())
    }

    /**
     * Read one item from an aggregate period.
     *
     * @param {'total'|'visits'|'journeys'|'videos'} item Item name.
     * @param {'total'|'daily'|'weekly'|'monthly'|'yearly'} [period='total'] Period name.
     * @param {string|null} [key] Explicit period key.
     * @returns {Promise<number|object>} Item value.
     */
    getItem = async (item, period = 'total', key = null) => {
        if (!COUNT_ITEMS.includes(item)) {
            throw new CountValidationError('Unsupported count item')
        }
        const row = await this.getPeriod(period, key)
        return item === 'total' ? row : item === 'videos' ? row.videos : row[item]
    }

    /**
     * Register controlled shutdown persistence handlers once.
     *
     * @returns {void}
     */
    registerShutdownHandlers = () => {
        if (this.shutdownHandlers) {
            return
        }

        this.shutdownHandlers = this.shutdown
        process.once('SIGINT', this.shutdown)
        process.once('SIGTERM', this.shutdown)
    }

    /**
     * Persist the final snapshot and terminate after a controlled signal.
     *
     * @returns {Promise<void>} Resolves only if process termination is overridden.
     */
    shutdown = async () => {
        await this.close().catch(() => undefined)
        process.exit(0)
    }

    /**
     * Stop persistence scheduling and save the final aggregate snapshot.
     *
     * @returns {Promise<void>} Resolves after the final save.
     */
    close = async () => {
        if (this.closePromise) {
            return this.closePromise
        }

        this.closed = true
        if (this.persistenceTimer) {
            clearTimeout(this.persistenceTimer)
            this.persistenceTimer = null
        }

        this.closePromise = this.enqueue(async () => {
            await this.writeSnapshot()
        })
        return this.closePromise
    }
}
