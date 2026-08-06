import {
    ContactMailConfigurationError,
    ContactMailDeliveryError,
    ContactMailService,
    ContactMailValidationError,
} from '../services/ContactMailService.js'

/** Expose the public contact form through a safe email-sending endpoint. */
export class ContactMailController {
    /**
     * @param {ContactMailService} mailer Contact email service.
     */
    constructor(mailer = new ContactMailService()) {
        if (!mailer) {
            throw new Error('mailer is undefined')
        }
        this.mailer = mailer
    }

    /**
     * Validate and send one public contact message.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Public-safe response envelope.
     */
    send = async ({body, set}) => {
        try {
            return await this.mailer.send(body)
        }
        catch (error) {
            if (error instanceof ContactMailValidationError) {
                set.status = 400
                return {success: false, error: error.message}
            }

            if (error instanceof ContactMailConfigurationError || error instanceof ContactMailDeliveryError) {
                set.status = 503
                return {success: false, error: 'Contact email delivery is temporarily unavailable'}
            }

            set.status = 500
            return {success: false, error: 'Unable to send contact message'}
        }
    }
}
