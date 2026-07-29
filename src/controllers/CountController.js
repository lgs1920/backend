import { CountStore, CountValidationError } from '../services/CountStore.js'

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
     * @param {object} set Elysia response state.
     * @returns {Promise<object>} Event response.
     */
    recordEvent = async (eventType, set) => {
        try {
            return await this.store.recordEvent(eventType)
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
    visit = async ({set}) => this.recordEvent('visit', set)

    /**
     * Record a journey event.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Event response.
     */
    journey = async ({set}) => this.recordEvent('journey', set)

    /**
     * Record a draft video event.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Event response.
     */
    videoDraft = async ({set}) => this.recordEvent('video/draft', set)

    /**
     * Record a high-quality video event.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Event response.
     */
    videoHq = async ({set}) => this.recordEvent('video/hq', set)

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
    getItem = async ({params, set}) => {
        try {
            return await this.store.getItem(params.item)
        }
        catch (error) {
            return this.handleReadError(set, error)
        }
    }

    /**
     * Read one item from a named period, defaulting to the current UTC key.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<number|object>} Item value or controlled error.
     */
    getItemPeriod = async ({params, set}) => {
        try {
            return await this.store.getItem(params.item, params.period)
        }
        catch (error) {
            return this.handleReadError(set, error)
        }
    }

    /**
     * Read a named period row using its current UTC key.
     *
     * @param {string} period Period map name.
     * @param {object} set Elysia response state.
     * @returns {Promise<object>} Period row or controlled error.
     */
    readCurrentPeriod = async (period, set) => {
        try {
            return await this.store.getPeriod(period)
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
     * @param {object} set Elysia response state.
     * @returns {Promise<object>} Period row or controlled error.
     */
    readPeriod = async (period, key, set) => {
        try {
            return await this.store.getPeriod(period, key)
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
    getDaily = async ({set}) => this.readCurrentPeriod('daily', set)

    /**
     * Read a historical daily aggregate row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Daily row.
     */
    getDailyAt = async ({params, set}) => this.readPeriod('daily', params.date, set)

    /**
     * Read the current weekly aggregate row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Weekly row.
     */
    getWeekly = async ({set}) => this.readCurrentPeriod('weekly', set)

    /**
     * Read a historical weekly aggregate row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Weekly row.
     */
    getWeeklyAt = async ({params, set}) => this.readPeriod('weekly', params.week, set)

    /**
     * Read the current monthly aggregate row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Monthly row.
     */
    getMonthly = async ({set}) => this.readCurrentPeriod('monthly', set)

    /**
     * Read a historical monthly aggregate row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Monthly row.
     */
    getMonthlyAt = async ({params, set}) => this.readPeriod('monthly', params.month, set)

    /**
     * Read the current yearly aggregate row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Yearly row.
     */
    getYearly = async ({set}) => this.readCurrentPeriod('yearly', set)

    /**
     * Read a historical yearly aggregate row.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Yearly row.
     */
    getYearlyAt = async ({params, set}) => this.readPeriod('yearly', params.year, set)
}
