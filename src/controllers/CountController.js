import { CountStore, CountValidationError } from '../services/CountStore.js'

/**
 * Extract the optional client time zone from an event payload.
 *
 * @param {*} body Parsed request body.
 * @returns {string|null} Client time zone, or null when omitted.
 * @throws {CountValidationError} If the payload is not a JSON object.
 */
const getEventTimeZone = (body) => {
    if (body === undefined || body === null || body === '') {
        return null
    }
    if (typeof body !== 'object' || Array.isArray(body)) {
        throw new CountValidationError('Invalid count event payload')
    }
    return body.timeZone ?? null
}

/**
 * Expose count event mutations and read-only aggregate lookups.
 */
export class CountController {
    /**
     * Create a count controller.
     *
     * @param {CountStore} store Aggregate store used by the handlers.
     */
    constructor(store = new CountStore()) {
        this.store = store
    }

    /**
     * Convert a controlled handler error into a safe client response.
     *
     * @param {object} set Elysia response state.
     * @param {number} status HTTP status code.
     * @param {string} message Public error message.
     * @returns {{success: boolean, error: string}} Error response.
     */
    errorResponse = (set, status, message) => {
        set.status = status
        return {success: false, error: message}
    }

    /**
     * Record a count event and return its updated aggregate values.
     *
     * @param {string} eventType Event name.
     * @param {*} body Parsed request body.
     * @param {object} set Elysia response state.
     * @returns {Promise<object>} Event response.
     */
    recordEvent = async (eventType, body, set) => {
        try {
            return await this.store.recordEvent(eventType, null, getEventTimeZone(body))
        }
        catch (error) {
            if (error instanceof CountValidationError) {
                return this.errorResponse(set, 400, error.message)
            }
            return this.errorResponse(set, 500, 'Unable to record count event')
        }
    }

    /**
     * Record a visit event.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Event response.
     */
    visit = async ({body, set}) => this.recordEvent('visit', body, set)

    /**
     * Record a journey event.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Event response.
     */
    journey = async ({body, set}) => this.recordEvent('journey', body, set)

    /**
     * Record a draft video event.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Event response.
     */
    videoDraft = async ({body, set}) => this.recordEvent('video/draft', body, set)

    /**
     * Record a high-quality video event.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Event response.
     */
    videoHq = async ({body, set}) => this.recordEvent('video/hq', body, set)

    /**
     * Read the complete aggregate snapshot.
     *
     * @returns {Promise<object>} Current snapshot.
     */
    getSnapshot = async () => this.store.getSnapshot()

    /**
     * Read one item from the lifetime total row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<number|object>} Item value or controlled error.
     */
    getItem = async ({params, query, set}) => {
        try {
            return await this.store.getItem(params.item, 'total', null, query?.timeZone)
        }
        catch (error) {
            return this.handleReadError(set, error)
        }
    }

    /**
     * Read one item from a named period, defaulting to the current client time zone key.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<number|object>} Item value or controlled error.
     */
    getItemPeriod = async ({params, query, set}) => {
        try {
            return await this.store.getItem(params.item, params.period, null, query?.timeZone)
        }
        catch (error) {
            return this.handleReadError(set, error)
        }
    }

    /**
     * Read a named period row using its current client time zone key.
     *
     * @param {string} period Period map name.
     * @param {object} query Parsed query parameters.
     * @param {object} set Elysia response state.
     * @returns {Promise<object>} Period row or controlled error.
     */
    readCurrentPeriod = async (period, query, set) => {
        try {
            return await this.store.getPeriod(period, null, query?.timeZone)
        }
        catch (error) {
            return this.handleReadError(set, error)
        }
    }

    /**
     * Read a named historical period row.
     *
     * @param {string} period Period map name.
     * @param {string} key Explicit period key.
     * @param {object} query Parsed query parameters.
     * @param {object} set Elysia response state.
     * @returns {Promise<object>} Period row or controlled error.
     */
    readPeriod = async (period, key, query, set) => {
        try {
            return await this.store.getPeriod(period, key, query?.timeZone)
        }
        catch (error) {
            return this.handleReadError(set, error)
        }
    }

    /**
     * Map a read error to a controlled response without exposing internals.
     *
     * @param {object} set Elysia response state.
     * @param {*} error Handler error.
     * @returns {{success: boolean, error: string}} Error response.
     */
    handleReadError = (set, error) => {
        if (error instanceof CountValidationError) {
            return this.errorResponse(set, 400, error.message)
        }
        return this.errorResponse(set, 500, 'Unable to read count data')
    }

    /**
     * Read the current daily aggregate row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Daily row.
     */
    getDaily = async ({query, set}) => this.readCurrentPeriod('daily', query, set)

    /**
     * Read a historical daily aggregate row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Daily row.
     */
    getDailyAt = async ({params, query, set}) => this.readPeriod('daily', params.date, query, set)

    /**
     * Read the current weekly aggregate row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Weekly row.
     */
    getWeekly = async ({query, set}) => this.readCurrentPeriod('weekly', query, set)

    /**
     * Read a historical weekly aggregate row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Weekly row.
     */
    getWeeklyAt = async ({params, query, set}) => this.readPeriod('weekly', params.week, query, set)

    /**
     * Read the current monthly aggregate row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Monthly row.
     */
    getMonthly = async ({query, set}) => this.readCurrentPeriod('monthly', query, set)

    /**
     * Read a historical monthly aggregate row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Monthly row.
     */
    getMonthlyAt = async ({params, query, set}) => this.readPeriod('monthly', params.month, query, set)

    /**
     * Read the current yearly aggregate row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Yearly row.
     */
    getYearly = async ({query, set}) => this.readCurrentPeriod('yearly', query, set)

    /**
     * Read a historical yearly aggregate row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Yearly row.
     */
    getYearlyAt = async ({params, query, set}) => this.readPeriod('yearly', params.year, query, set)
}
