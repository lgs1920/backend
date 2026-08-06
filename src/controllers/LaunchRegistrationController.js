import {
    LaunchRegistrationStorageError,
    LaunchRegistrationValidationError,
} from '../services/LaunchRegistrationStore.js'
import {ContactRateLimiter} from '../utils/ContactRateLimiter.js'

/**
 * Expose public launch registration mutations without returning personal data.
 */
export class LaunchRegistrationController {
    /**
     * Create a launch registration controller.
     *
     * @param {import('../services/LaunchRegistrationStore.js').LaunchRegistrationStore} store Launch registration store used by the handler.
     * @param {object} [options] Controller options.
     * @param {ContactRateLimiter} [options.rateLimiter] Public registration rate limiter.
     */
    constructor(store, {
        rateLimiter = new ContactRateLimiter({
            trustProxy: process.env.LGS1920_TRUST_PROXY === 'true',
        }),
    } = {}) {
        if (!store) {
            throw new Error('store is undefined')
        }
        if (!rateLimiter) {
            throw new Error('rateLimiter is undefined')
        }
        this.store = store
        this.rateLimiter = rateLimiter
    }

    /**
     * Validate and persist one public registration.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Public-safe response envelope.
     */
    register = async ({body, request, server, set}) => {
        const limited = this.rateLimiter.check('registration', {request, server, set})
        if (limited) {
            set.status = 429
            set.headers['Retry-After'] = String(limited.retryAfterSeconds)
            return {success: false, error: 'Too many registration requests'}
        }

        try {
            return await this.store.register(body)
        }
        catch (error) {
            if (error instanceof LaunchRegistrationValidationError) {
                set.status = 400
                return {success: false, error: error.message}
            }

            if (error instanceof LaunchRegistrationStorageError) {
                set.status = 503
                return {success: false, error: 'Launch registration is temporarily unavailable'}
            }

            set.status = 500
            return {success: false, error: 'Unable to save launch registration'}
        }
    }
}
