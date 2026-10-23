import {
    ContactMailConfigurationError,
    ContactMailDeliveryError,
    ContactMailService,
    ContactMailValidationError,
} from '../services/ContactMailService.js'
import { getAllowedOrigins } from '../utils/BackendSecurity.js'
import {
    assertContactCsrfToken,
    assertContactOrigin,
    ContactRequestSecurityError,
    createContactCsrfToken,
} from '../utils/ContactRequestSecurity.js'
import {ContactRateLimiter} from '../utils/ContactRateLimiter.js'

/** Expose the public contact form through a safe email-sending endpoint. */
export class ContactMailController {
    /**
     * @param {ContactMailService} mailer Contact email service.
     */
    constructor(mailer = new ContactMailService(), {
        allowedOrigins = getAllowedOrigins(),
        csrfSecret = process.env.LGS1920_CONTACT_CSRF_SECRET,
        rateLimiter = new ContactRateLimiter({
            trustProxy: process.env.LGS1920_TRUST_PROXY === 'true',
        }),
    } = {}) {
        if (!mailer) {
            throw new Error('mailer is undefined')
        }
        this.mailer = mailer
        this.allowedOrigins = allowedOrigins
        this.csrfSecret = csrfSecret
        this.rateLimiter = rateLimiter
    }

    /**
     * Apply the endpoint-specific contact rate limit.
     *
     * @param {'token'|'send'} scope Contact endpoint scope.
     * @param {object} context Elysia request context.
     * @returns {object|null} Public-safe HTTP response when limited, otherwise null.
     */
    checkRateLimit = (scope, context) => {
        const limited = this.rateLimiter.check(scope, context)
        if (!limited) {
            return null
        }

        context.set.status = 429
        context.set.headers['Retry-After'] = String(limited.retryAfterSeconds)
        return {
            success: false,
            error:   'Too many contact requests',
        }
    }

    /**
     * Issue a short-lived CSRF token for an allowed contact form origin.
     *
     * @param {object} context Elysia request context.
     * @returns {{success: boolean, token: string}} Public contact token response.
     */
    issueToken = ({request, server, set}) => {
        try {
            assertContactOrigin(request.headers.get('origin'), this.allowedOrigins)
            set.headers['Cache-Control'] = 'no-store'
            const limited = this.checkRateLimit('token', {request, server, set})
            if (limited) {
                return limited
            }

            return {
                success: true,
                token:   createContactCsrfToken({secret: this.csrfSecret}),
            }
        }
        catch (error) {
            if (error instanceof ContactRequestSecurityError) {
                set.status = error.configuration ? 503 : 403
                return {success: false, error: error.message}
            }

            set.status = 503
            return {success: false, error: 'Contact request security is unavailable'}
        }
    }

    /**
     * Validate and send one public contact message.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Public-safe response envelope.
     */
    send = async ({body, request, server, set}) => {
        try {
            assertContactOrigin(request.headers.get('origin'), this.allowedOrigins)
            assertContactCsrfToken({
                token:  body?.csrfToken,
                secret: this.csrfSecret,
            })
            const limited = this.checkRateLimit('send', {request, server, set})
            if (limited) {
                return limited
            }

            return await this.mailer.send(body)
        }
        catch (error) {
            if (error instanceof ContactRequestSecurityError) {
                set.status = error.configuration ? 503 : 403
                return {success: false, error: error.message}
            }

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
