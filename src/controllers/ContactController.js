import { ContactStorageError, ContactValidationError } from '../services/ContactStore.js'

/**
 * Expose public launch registration mutations without returning personal data.
 */
export class ContactController {
    /**
     * Create a contact controller.
     *
     * @param {import('../services/ContactStore.js').ContactStore} store Contact store used by the handler.
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
    submit = async ({body, set}) => {
        try {
            return await this.store.create(body)
        }
        catch (error) {
            if (error instanceof ContactValidationError) {
                set.status = 400
                return {success: false, error: error.message}
            }

            if (error instanceof ContactStorageError) {
                set.status = 503
                return {success: false, error: 'Launch registration is temporarily unavailable'}
            }

            set.status = 500
            return {success: false, error: 'Unable to save launch registration'}
        }
    }
}
