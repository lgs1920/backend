import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {normalizeFormMailMetadata} from '../utils/FormMailContract.js'

export const LAUNCH_REGISTRATION_DATA_PATH = path.join('data', 'launch-registrations.json')
export const LAUNCH_REGISTRATION_PENDING_DATA_PATH = path.join('data', 'launch-registrations-pending.json')
export const LAUNCH_REGISTRATION_SCHEMA_VERSION = 3

const SUPPORTED_SCHEMA_VERSIONS = [1, 2, LAUNCH_REGISTRATION_SCHEMA_VERSION]
const MAX_NAME_LENGTH = 80
const MAX_EMAIL_LENGTH = 254
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TOKEN_BYTES = 32
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/
const CONFIRMATION_TTL_MS = 48 * 60 * 60 * 1000
const CONFIRMATION_RESEND_COOLDOWN_MS = 60 * 1000

/**
 * Error raised when a launch registration does not satisfy the public API contract.
 */
export class LaunchRegistrationValidationError extends Error {
    /**
     * Create a launch registration validation error.
     *
     * @param {string} message Human-readable validation message.
     */
    constructor(message) {
        super(message)
        this.name = 'LaunchRegistrationValidationError'
    }
}

/**
 * Error raised when a normalized email is already confirmed.
 */
export class LaunchRegistrationDuplicateError extends Error {
    /**
     * Create a duplicate launch registration error.
     */
    constructor() {
        super('Launch registration already exists')
        this.name = 'LaunchRegistrationDuplicateError'
    }
}

/**
 * Error raised when a normalized email already has an unconfirmed registration.
 */
export class LaunchRegistrationPendingError extends Error {
    /**
     * Create a pending launch registration error.
     */
    constructor() {
        super('Launch registration confirmation is already pending')
        this.name = 'LaunchRegistrationPendingError'
    }
}

/**
 * Error raised when a confirmation cannot be resent because the cooldown is active.
 */
export class LaunchRegistrationResendCooldownError extends Error {
    /**
     * Create a launch registration resend cooldown error.
     *
     * @param {number} retryAfterSeconds Number of seconds before another resend is allowed.
     */
    constructor(retryAfterSeconds) {
        super('Launch registration confirmation resend is temporarily unavailable')
        this.name = 'LaunchRegistrationResendCooldownError'
        this.retryAfterSeconds = retryAfterSeconds
    }
}

/**
 * Error raised when no pending launch registration matches an email address.
 */
export class LaunchRegistrationNotPendingError extends Error {
    /**
     * Create a missing pending launch registration error.
     */
    constructor() {
        super('No pending launch registration exists')
        this.name = 'LaunchRegistrationNotPendingError'
    }
}

/**
 * Error raised when launch registration data cannot be safely read or written.
 */
export class LaunchRegistrationStorageError extends Error {
    /**
     * Create a launch registration storage error.
     *
     * @param {string} message Human-readable storage message.
     * @param {*} [cause] Original storage error.
     */
    constructor(message, cause = undefined) {
        super(message, {cause})
        this.name = 'LaunchRegistrationStorageError'
    }
}

/**
 * Check whether a value is a plain object suitable for a JSON payload.
 *
 * @param {*} value Candidate value.
 * @returns {boolean} Whether the value is a non-array object.
 */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Remove site-rendered mail bodies from a persisted registration record.
 *
 * @param {*} registration Candidate registration record.
 * @returns {*} Registration record without transient rendered mail bodies.
 */
const stripTransientMailMessages = (registration) => {
    if (!isObject(registration)) {
        return registration
    }

    const storedRegistration = {...registration}
    delete storedRegistration.renderedMessage
    delete storedRegistration.supportRenderedMessage
    return storedRegistration
}

/**
 * Read and normalize one bounded person-name field.
 *
 * @param {*} value Raw field value.
 * @param {string} label Field label used in validation errors.
 * @returns {string} Normalized name.
 * @throws {LaunchRegistrationValidationError} If the name is invalid.
 */
const readName = (value, label) => {
    if (typeof value !== 'string') {
        throw new LaunchRegistrationValidationError(`Invalid ${label}`)
    }

    const name = value.trim()
    if (!name || name.length > MAX_NAME_LENGTH) {
        throw new LaunchRegistrationValidationError(`Invalid ${label}`)
    }

    return name
}

/**
 * Read and normalize one bounded email address.
 *
 * @param {*} value Raw email value.
 * @returns {string} Normalized email address.
 * @throws {LaunchRegistrationValidationError} If the email is invalid.
 */
const readEmail = (value) => {
    if (typeof value !== 'string') {
        throw new LaunchRegistrationValidationError('Invalid email address')
    }

    const email = value.trim().toLowerCase()
    if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
        throw new LaunchRegistrationValidationError('Invalid email address')
    }

    return email
}

/**
 * Normalize an optional opaque mail target key for private persistence.
 *
 * @param {*} value Raw target key.
 * @returns {string|null} Normalized target key or null when omitted.
 */
const readMailTarget = (value) => typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : null

/**
 * Create a cryptographically random URL-safe token.
 *
 * @returns {string} Raw token.
 */
const createToken = () => randomBytes(TOKEN_BYTES).toString('base64url')

/**
 * Hash one token before it is persisted.
 *
 * @param {string} token Raw token.
 * @returns {Buffer} SHA-256 digest.
 */
const hashToken = (token) => createHash('sha256').update(token).digest()

/**
 * Validate the shape of a URL-safe registration token.
 *
 * @param {*} token Candidate token.
 * @returns {boolean} Whether the token shape is valid.
 */
const isValidToken = (token) => typeof token === 'string' && TOKEN_PATTERN.test(token)

/**
 * Compare a raw token with a persisted hash using constant-time equality.
 *
 * @param {*} storedHash Persisted hexadecimal SHA-256 digest.
 * @param {*} token Raw token received from a client.
 * @returns {boolean} Whether the token matches.
 */
const tokensMatch = (storedHash, token) => {
    if (typeof storedHash !== 'string' || !isValidToken(token)) {
        return false
    }

    let storedBytes
    try {
        storedBytes = Buffer.from(storedHash, 'hex')
    }
    catch {
        return false
    }

    const receivedBytes = hashToken(token)
    return storedBytes.length === receivedBytes.length && timingSafeEqual(storedBytes, receivedBytes)
}

/**
 * Check whether a pending registration has expired.
 *
 * @param {*} expiresAt ISO expiration timestamp.
 * @param {Date} now Current clock value.
 * @returns {boolean} Whether the registration is expired or malformed.
 */
const isExpired = (expiresAt, now) => {
    const expirationTime = typeof expiresAt === 'string' ? Date.parse(expiresAt) : Number.NaN
    return !Number.isFinite(expirationTime) || expirationTime <= now.getTime()
}

/**
 * Derive the pending JSON path beside a confirmed-registration path.
 *
 * @param {string} filePath Confirmed-registration path.
 * @returns {string} Derived pending-registration path.
 */
const derivePendingFilePath = (filePath) => {
    const extension = path.extname(filePath)
    if (extension.toLowerCase() !== '.json') {
        return `${filePath}-pending`
    }

    return path.join(
        path.dirname(filePath),
        `${path.basename(filePath, extension)}-pending${extension}`,
    )
}

/**
 * Read and validate one persisted registration envelope.
 *
 * @param {string} filePath Registration file path.
 * @returns {Promise<{registrations: object[], revision: string|null}>} Parsed records and file revision.
 */
const readPersistedFile = async (filePath) => {
    let content
    try {
        content = await readFile(filePath, 'utf8')
    }
    catch (error) {
        if (error?.code === 'ENOENT') {
            return {registrations: [], revision: null}
        }
        throw error
    }

    const persisted = JSON.parse(content)
    if (!isObject(persisted)
        || !SUPPORTED_SCHEMA_VERSIONS.includes(persisted.schemaVersion)
        || !Array.isArray(persisted.registrations)) {
        throw new Error('Invalid launch registration file shape')
    }

    return {
        registrations: persisted.registrations.map(stripTransientMailMessages),
        revision:      createHash('sha256').update(content).digest('hex'),
    }
}

/**
 * Persist one registration envelope through a temporary file and atomic rename.
 *
 * @param {string} filePath Registration file path.
 * @param {object[]} registrations Records to persist.
 * @returns {Promise<string>} SHA-256 revision of the persisted content.
 */
const writePersistedFile = async (filePath, registrations) => {
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
    const payload = JSON.stringify({
        schemaVersion: LAUNCH_REGISTRATION_SCHEMA_VERSION,
        registrations: registrations.map(stripTransientMailMessages),
    }, null, 2)

    try {
        await mkdir(path.dirname(filePath), {recursive: true})
        await writeFile(temporaryPath, `${payload}\n`, {encoding: 'utf8', mode: 0o600})
        await rename(temporaryPath, filePath)
    }
    catch (error) {
        await rm(temporaryPath, {force: true}).catch(() => undefined)
        throw error
    }

    return createHash('sha256').update(`${payload}\n`).digest('hex')
}

/**
 * Build a normalized email lookup set from persisted records.
 *
 * @param {object[]} registrations Persisted records.
 * @returns {Set<string>} Normalized email set.
 */
const createEmailSet = (registrations) => new Set(registrations
    .map(registration => typeof registration?.email === 'string' ? registration.email.trim().toLowerCase() : null)
    .filter(Boolean))

/**
 * Normalize one email address for launch-registration administration operations.
 *
 * @param {*} value Raw email address.
 * @returns {string} Normalized email address.
 * @throws {LaunchRegistrationValidationError} If the address is invalid.
 */
export const normalizeLaunchRegistrationEmail = (value) => readEmail(value)

/**
 * Normalize and validate a launch registration received from the public site.
 *
 * @param {*} payload JSON request body.
 * @returns {{form: string, locale: string, renderedMessage: string|null, supportRenderedMessage: string|null, firstName: string, lastName: string, email: string, consent: boolean}} Normalized registration. Rendered mail bodies are transient and are never persisted.
 * @throws {LaunchRegistrationValidationError} If the payload is incomplete or invalid.
 */
export const normalizeLaunchRegistrationPayload = (payload) => {
    if (!isObject(payload)) {
        throw new LaunchRegistrationValidationError('Invalid launch registration payload')
    }

    if (payload.consent !== true) {
        throw new LaunchRegistrationValidationError('Consent is required')
    }

    let metadata
    try {
        metadata = normalizeFormMailMetadata(payload, {defaultForm: 'launch-registration', expectedForm: 'launch-registration'})
    }
    catch (error) {
        throw new LaunchRegistrationValidationError(error.message)
    }

    return {
        ...metadata,
        firstName: readName(payload.firstName, 'first name'),
        lastName:  readName(payload.lastName, 'last name'),
        email:     readEmail(payload.email),
        consent:   true,
    }
}

/**
 * Detect one filled anti-spam honeypot field.
 *
 * @param {*} payload Raw request body.
 * @returns {boolean} Whether the honeypot contains content.
 */
const isHoneypotFilled = (payload) => isObject(payload)
    && typeof payload.website === 'string'
    && payload.website.trim().length > 0

/**
 * Create and persist launch registrations in separate confirmed and pending files.
 */
export class LaunchRegistrationStore {
    /**
     * Create a launch registration store.
     *
     * @param {object} options Store configuration.
     * @param {string} [options.backendHome] Backend home directory.
     * @param {string} [options.filePath] Explicit confirmed-registration JSON path.
     * @param {string} [options.pendingFilePath] Explicit pending-registration JSON path.
     * @param {() => Date} [options.clock] Clock used to create deterministic timestamps.
     */
    constructor({
                    backendHome = process.env.LGS1920_BACKEND_HOME || process.cwd(),
                    filePath = undefined,
                    pendingFilePath = undefined,
                    clock = () => new Date(),
                } = {}) {
        this.backendHome = path.resolve(backendHome)
        this.filePath = path.resolve(filePath ?? path.join(this.backendHome, LAUNCH_REGISTRATION_DATA_PATH))
        this.pendingFilePath = path.resolve(pendingFilePath ?? derivePendingFilePath(this.filePath))
        this.clock = clock
        this.registrations = []
        this.pendingRegistrations = []
        this.registrationEmails = new Set()
        this.pendingRegistrationEmails = new Set()
        this.mutationQueue = Promise.resolve()
        this.fileRevision = null
        this.pendingFileRevision = null
        this.ready = this.load()
    }

    /**
     * Load both registration files without exposing their contents through the API.
     *
     * @returns {Promise<void>} Completion promise.
     * @throws {LaunchRegistrationStorageError} If an existing file is malformed or unreadable.
     */
    load = async () => {
        try {
            await mkdir(path.dirname(this.filePath), {recursive: true})
            await mkdir(path.dirname(this.pendingFilePath), {recursive: true})
            const [confirmed, pending] = await Promise.all([
                readPersistedFile(this.filePath),
                readPersistedFile(this.pendingFilePath),
            ])

            this.registrations = confirmed.registrations
            this.registrationEmails = createEmailSet(this.registrations)
            const confirmedEmails = this.registrationEmails
            this.pendingRegistrations = pending.registrations.filter(registration => {
                const email = typeof registration?.email === 'string'
                    ? registration.email.trim().toLowerCase()
                    : ''
                return !email || !confirmedEmails.has(email)
            })
            this.pendingRegistrationEmails = createEmailSet(this.pendingRegistrations)
            this.fileRevision = confirmed.revision
            this.pendingFileRevision = pending.revision
        }
        catch (error) {
            if (error instanceof LaunchRegistrationStorageError) {
                throw error
            }
            throw new LaunchRegistrationStorageError('Unable to read launch registration data', error)
        }
    }

    /**
     * Reload registration data and report whether either file changed externally.
     *
     * @returns {Promise<boolean>} Whether the persisted files changed.
     */
    refresh = async () => {
        await this.ready
        const previousRevision = `${this.fileRevision ?? ''}:${this.pendingFileRevision ?? ''}`
        await this.load()
        const currentRevision = `${this.fileRevision ?? ''}:${this.pendingFileRevision ?? ''}`
        return previousRevision !== currentRevision
    }

    /**
     * Check whether a normalized email exists in either registration state.
     *
     * @param {*} email Email address to check.
     * @returns {Promise<boolean>} Whether the email is already registered or pending.
     */
    hasRegistration = async (email) => (await this.getRegistrationStatus(email)) !== null

    /**
     * Resolve the current state of one email address.
     *
     * @param {*} email Email address to check.
     * @returns {Promise<'confirmed'|'pending'|null>} Current registration state.
     */
    getRegistrationStatus = async (email) => {
        await this.refresh()
        const normalizedEmail = readEmail(email)
        if (this.registrationEmails.has(normalizedEmail)) {
            return 'confirmed'
        }
        if (this.pendingRegistrationEmails.has(normalizedEmail)) {
            return 'pending'
        }
        return null
    }

    /**
     * Read one pending registration before a resend without exposing it through
     * a public response.
     *
     * @param {*} email Pending registration email address.
     * @returns {Promise<object>} Copy of the pending registration.
     * @throws {LaunchRegistrationValidationError} If the email is invalid.
     * @throws {LaunchRegistrationNotPendingError} If no pending registration matches.
     */
    getPendingRegistration = (email) => this.mutationQueue.then(async () => {
        await this.refresh()
        const normalizedEmail = readEmail(email)
        const registration = this.pendingRegistrations.find(candidate => typeof candidate?.email === 'string'
            && candidate.email.trim().toLowerCase() === normalizedEmail)
        if (!registration) {
            throw new LaunchRegistrationNotPendingError()
        }

        return {...registration}
    })

    /**
     * Validate a pending confirmation token without consuming it.
     *
     * @param {*} id Pending registration identifier.
     * @param {*} token Raw confirmation token.
     * @returns {Promise<object|false>} Pending registration copy or false for an invalid link.
     */
    getPendingConfirmation = (id, token) => this.mutationQueue.then(async () => {
        await this.refresh()

        if (typeof id !== 'string' || !id.trim() || !isValidToken(token)) {
            return false
        }

        const registration = this.pendingRegistrations.find(candidate => candidate?.id === id.trim())
        if (!registration || isExpired(registration.expiresAt, this.clock())
            || !tokensMatch(registration.confirmationTokenHash, token)) {
            return false
        }

        return {...registration}
    })

    /**
     * Append one pending registration to the JSON file atomically.
     *
     * @param {*} payload Raw public request body.
     * @returns {Promise<{success: boolean, stored: boolean, status: string, confirmationRequired: boolean, id: string, confirmationToken: string}>} Internal registration result.
     */
    register = (payload) => {
        const operation = this.mutationQueue.then(async () => {
            await this.refresh()

            if (isHoneypotFilled(payload)) {
                return {success: true, stored: false}
            }

            const registration = normalizeLaunchRegistrationPayload(payload)
            if (this.registrationEmails.has(registration.email)) {
                throw new LaunchRegistrationDuplicateError()
            }

            const pendingIndex = this.pendingRegistrations.findIndex(({email}) => typeof email === 'string' && email.trim().toLowerCase() === registration.email)
            if (pendingIndex >= 0) {
                if (!isExpired(this.pendingRegistrations[pendingIndex].expiresAt, this.clock())) {
                    throw new LaunchRegistrationPendingError()
                }

                const [expiredRegistration] = this.pendingRegistrations.splice(pendingIndex, 1)
                this.pendingRegistrationEmails.delete(expiredRegistration.email)
            }

            const now = this.clock()
            const confirmationToken = createToken()
            const storedRegistration = {
                id:                     randomUUID(),
                form:                   registration.form,
                locale:                 registration.locale,
                firstName:              registration.firstName,
                lastName:               registration.lastName,
                email:                  registration.email,
                consent:                true,
                consentAt:              now.toISOString(),
                consentPurpose:          'studio-launch',
                createdAt:               now.toISOString(),
                expiresAt:               new Date(now.getTime() + CONFIRMATION_TTL_MS).toISOString(),
                confirmationSentAt:      now.toISOString(),
                confirmationTokenHash:   hashToken(confirmationToken).toString('hex'),
                mailTarget:              readMailTarget(payload?.to),
            }
            this.pendingRegistrations.push(storedRegistration)
            this.pendingRegistrationEmails.add(registration.email)
            await this.savePendingRegistrations()

            return {
                success:              true,
                stored:               true,
                status:               'pending',
                confirmationRequired: true,
                id:                   storedRegistration.id,
                confirmationToken,
            }
        })

        this.mutationQueue = operation.catch(() => undefined)
        return operation
    }

    /**
     * Remove one pending registration after confirmation-email delivery fails.
     *
     * @param {string} id Registration identifier to remove.
     * @returns {Promise<boolean>} Whether the registration was removed.
     * @throws {LaunchRegistrationStorageError} If persistence fails.
     */
    removePendingRegistration = (id) => {
        const operation = this.mutationQueue.then(async () => {
            await this.refresh()

            const registrationIndex = this.pendingRegistrations.findIndex(registration => registration?.id === id)
            if (registrationIndex < 0) {
                return false
            }

            const [registration] = this.pendingRegistrations.splice(registrationIndex, 1)
            this.pendingRegistrationEmails.delete(registration.email.trim().toLowerCase())
            await this.savePendingRegistrations()
            return true
        })

        this.mutationQueue = operation.catch(() => undefined)
        return operation
    }

    /**
     * Rotate and persist the confirmation token for one pending registration.
     *
     * @param {*} email Pending registration email address.
     * @returns {Promise<object>} Pending registration data and the raw replacement token.
     * @throws {LaunchRegistrationValidationError} If the email is invalid.
     * @throws {LaunchRegistrationNotPendingError} If no pending registration matches.
     * @throws {LaunchRegistrationResendCooldownError} If the resend cooldown is active.
     * @throws {LaunchRegistrationStorageError} If persistence fails.
     */
    resendConfirmation = (email) => {
        const operation = this.mutationQueue.then(async () => {
            await this.refresh()
            const normalizedEmail = readEmail(email)
            const registrationIndex = this.pendingRegistrations.findIndex(registration => typeof registration?.email === 'string' && registration.email.trim().toLowerCase() === normalizedEmail)
            if (registrationIndex < 0) {
                throw new LaunchRegistrationNotPendingError()
            }

            const current = this.pendingRegistrations[registrationIndex]
            const now = this.clock()
            const lastSentAt = Date.parse(current.confirmationSentAt ?? current.createdAt ?? '')
            if (Number.isFinite(lastSentAt) && now.getTime() - lastSentAt < CONFIRMATION_RESEND_COOLDOWN_MS) {
                const retryAfterSeconds = Math.max(1, Math.ceil((CONFIRMATION_RESEND_COOLDOWN_MS - (now.getTime() - lastSentAt)) / 1000))
                throw new LaunchRegistrationResendCooldownError(retryAfterSeconds)
            }

            if (isExpired(current.expiresAt, now)) {
                const [expiredRegistration] = this.pendingRegistrations.splice(registrationIndex, 1)
                this.pendingRegistrationEmails.delete(expiredRegistration.email)
                await this.savePendingRegistrations()
                throw new LaunchRegistrationNotPendingError()
            }

            const confirmationToken = createToken()
            const updatedRegistration = {
                ...current,
                expiresAt:             new Date(now.getTime() + CONFIRMATION_TTL_MS).toISOString(),
                confirmationSentAt:    now.toISOString(),
                confirmationTokenHash: hashToken(confirmationToken).toString('hex'),
            }
            this.pendingRegistrations[registrationIndex] = updatedRegistration
            await this.savePendingRegistrations()

            return {
                ...updatedRegistration,
                confirmationToken,
            }
        })

        this.mutationQueue = operation.catch(() => undefined)
        return operation
    }

    /**
     * Confirm one pending registration and move it to the confirmed file.
     *
     * @param {*} id Pending registration identifier.
     * @param {*} token Raw confirmation token from the email link.
     * @returns {Promise<object|false>} Confirmed registration data and cancellation token, or false for an invalid link.
     * @throws {LaunchRegistrationStorageError} If persistence fails.
     */
    confirm = (id, token) => {
        const operation = this.mutationQueue.then(async () => {
            await this.refresh()

            if (typeof id !== 'string' || !id.trim() || !isValidToken(token)) {
                return false
            }

            const registrationIndex = this.pendingRegistrations.findIndex(registration => registration?.id === id.trim())
            if (registrationIndex < 0) {
                return false
            }

            const pendingRegistration = this.pendingRegistrations[registrationIndex]
            if (isExpired(pendingRegistration.expiresAt, this.clock())
                || !tokensMatch(pendingRegistration.confirmationTokenHash, token)) {
                return false
            }

            const confirmedAt = this.clock().toISOString()
            const cancellationToken = createToken()
            const confirmedRegistration = {...pendingRegistration}
            delete confirmedRegistration.expiresAt
            delete confirmedRegistration.confirmationSentAt
            delete confirmedRegistration.confirmationTokenHash
            confirmedRegistration.confirmedAt = confirmedAt
            confirmedRegistration.cancellationTokenHash = hashToken(cancellationToken).toString('hex')

            this.pendingRegistrations.splice(registrationIndex, 1)
            this.pendingRegistrationEmails.delete(confirmedRegistration.email.trim().toLowerCase())
            this.registrations.push(confirmedRegistration)
            this.registrationEmails.add(confirmedRegistration.email.trim().toLowerCase())
            await this.saveAll()

            return {
                ...confirmedRegistration,
                cancellationToken,
            }
        })

        this.mutationQueue = operation.catch(() => undefined)
        return operation
    }

    /**
     * Remove one persisted confirmed registration after a delivery failure.
     *
     * @param {string} id Registration identifier to remove.
     * @returns {Promise<boolean>} Whether the registration was removed.
     * @throws {LaunchRegistrationStorageError} If persistence fails.
     */
    removeRegistration = (id) => {
        const operation = this.mutationQueue.then(async () => {
            await this.refresh()

            const registrationIndex = this.registrations.findIndex(registration => registration?.id === id)
            if (registrationIndex < 0) {
                return false
            }

            const [registration] = this.registrations.splice(registrationIndex, 1)
            this.registrationEmails.delete(registration.email.trim().toLowerCase())
            await this.saveRegistrations()
            return true
        })

        this.mutationQueue = operation.catch(() => undefined)
        return operation
    }

    /**
     * Revoke one confirmed launch registration with its single-purpose email token.
     *
     * @param {*} id Stored registration identifier.
     * @param {*} token Raw cancellation token from the email link.
     * @returns {Promise<{email: string}|false>} Removed registration email, or false when no matching registration exists.
     * @throws {LaunchRegistrationStorageError} If persistence fails.
     */
    revoke = (id, token) => {
        const operation = this.mutationQueue.then(async () => {
            await this.refresh()

            if (typeof id !== 'string' || !id.trim() || !isValidToken(token)) {
                return false
            }

            const registrationIndex = this.registrations.findIndex(registration => registration?.id === id.trim())
            if (registrationIndex < 0 || !tokensMatch(this.registrations[registrationIndex].cancellationTokenHash, token)) {
                return false
            }

            const [registration] = this.registrations.splice(registrationIndex, 1)
            this.registrationEmails.delete(registration.email.trim().toLowerCase())
            await this.saveRegistrations()
            return {email: registration.email}
        })

        this.mutationQueue = operation.catch(() => undefined)
        return operation
    }

    /**
     * Persist confirmed registrations through a temporary file and atomic rename.
     *
     * @returns {Promise<void>} Completion promise.
     * @throws {LaunchRegistrationStorageError} If persistence fails.
     */
    saveRegistrations = async () => {
        try {
            this.fileRevision = await writePersistedFile(this.filePath, this.registrations)
        }
        catch (error) {
            throw new LaunchRegistrationStorageError('Unable to save launch registration data', error)
        }
    }

    /**
     * Persist pending registrations through a temporary file and atomic rename.
     *
     * @returns {Promise<void>} Completion promise.
     * @throws {LaunchRegistrationStorageError} If persistence fails.
     */
    savePendingRegistrations = async () => {
        try {
            this.pendingFileRevision = await writePersistedFile(this.pendingFilePath, this.pendingRegistrations)
        }
        catch (error) {
            throw new LaunchRegistrationStorageError('Unable to save pending launch registration data', error)
        }
    }

    /**
     * Persist both registration states in the order that preserves a confirmed record during a partial write.
     *
     * @returns {Promise<void>} Completion promise.
     * @throws {LaunchRegistrationStorageError} If persistence fails.
     */
    saveAll = async () => {
        await this.saveRegistrations()
        await this.savePendingRegistrations()
    }

    /**
     * Persist the confirmed registration list.
     *
     * @returns {Promise<void>} Completion promise.
     * @throws {LaunchRegistrationStorageError} If persistence fails.
     */
    save = this.saveRegistrations
}
