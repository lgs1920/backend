import {
    LaunchRegistrationStorageError,
    LaunchRegistrationValidationError,
} from '../services/LaunchRegistrationStore.js'

/**
 * Expose public launch registration mutations without returning personal data.
 */
export class LaunchRegistrationController {
    /**
     * Create a launch registration controller.
     *
     * @param {import('../services/LaunchRegistrationStore.js').LaunchRegistrationStore} store Launch registration store used by the handler.
     */
    constructor(store) {
        if (!store) {
            throw new Error('store is undefined')
        }
        this.store = store
    }

    /**
     * Validate and persist one public registration.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Public-safe response envelope.
     */
    register = async ({body, set}) => {
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
