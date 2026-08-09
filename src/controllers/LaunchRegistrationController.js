import {
    ContactMailConfigurationError,
    ContactMailDeliveryError,
    ContactMailService,
    ContactMailValidationError,
    normalizeLaunchRegistrationMessage,
} from '../services/ContactMailService.js'
import {
    LaunchRegistrationDuplicateError,
    LaunchRegistrationStorageError,
    LaunchRegistrationValidationError,
} from '../services/LaunchRegistrationStore.js'
import {getAllowedOrigins} from '../utils/BackendSecurity.js'
import {assertContactOrigin, ContactRequestSecurityError} from '../utils/ContactRequestSecurity.js'
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
     * @param {string[]} [options.allowedOrigins] Exact browser origins allowed to submit registrations.
     * @param {ContactMailService|null} [options.mailer] Optional shared form mail transport.
     * @param {ContactRateLimiter} [options.rateLimiter] Public registration rate limiter.
     */
    constructor(store, {
        allowedOrigins = getAllowedOrigins(),
        mailer = null,
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
        this.allowedOrigins = allowedOrigins
        this.mailer = mailer
        this.rateLimiter = rateLimiter
    }

    /**
     * Validate and persist one public registration.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Public-safe response envelope.
     */
    register = async ({body, request, server, set}) => {
        try {
            assertContactOrigin(request.headers.get('origin'), this.allowedOrigins)

            const limited = this.rateLimiter.check('registration', {request, server, set})
            if (limited) {
                set.status = 429
                set.headers['Retry-After'] = String(limited.retryAfterSeconds)
                return {success: false, error: 'Too many registration requests'}
            }

            const honeypotFilled = typeof body?.website === 'string' && body.website.trim().length > 0
            const mailPayload = this.mailer && !honeypotFilled
                ? normalizeLaunchRegistrationMessage({...body, form: body?.form ?? 'launch-registration'})
                : null
            if (mailPayload) {
                this.mailer.getConfiguredAddresses(mailPayload.to)
            }

            const result = await this.store.register(body)
            const {id, cancellationToken, ...publicResult} = result
            if (!this.mailer || !result.stored) {
                return publicResult
            }

            await this.mailer.send(mailPayload, {
                form:              'launch-registration',
                registrationId:     id,
                cancellationToken,
            })
            return {...publicResult, sent: true}
        }
        catch (error) {
            if (error instanceof ContactRequestSecurityError) {
                set.status = 403
                return {success: false, error: 'Registration request origin is not allowed'}
            }

            if (error instanceof LaunchRegistrationDuplicateError) {
                set.status = 409
                return {success: false, error: 'Already registered'}
            }

            if (error instanceof LaunchRegistrationValidationError) {
                set.status = 400
                return {success: false, error: error.message}
            }

            if (error instanceof LaunchRegistrationStorageError) {
                set.status = 503
                return {success: false, error: 'Launch registration is temporarily unavailable'}
            }

            if (error instanceof ContactMailValidationError) {
                set.status = 400
                return {success: false, error: error.message}
            }

            if (error instanceof ContactMailConfigurationError || error instanceof ContactMailDeliveryError) {
                set.status = 503
                return {success: false, error: 'Launch registration email delivery is temporarily unavailable'}
            }

            set.status = 500
            return {success: false, error: 'Unable to save launch registration'}
        }
    }

    /**
     * Revoke one launch registration from its private email link.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<Response>} Public-safe revocation response.
     */
    revoke = async ({query, set}) => {
        const locale = query?.locale === 'fr' ? 'fr' : 'en'
        const messages = locale === 'fr'
            ? {
                success: 'Votre inscription au lancement de LGS1920 Studio a été annulée.',
                invalid: 'Ce lien d’annulation est invalide ou a déjà été utilisé.',
                mailFailure: 'Votre désinscription a bien été prise en compte, mais l’e-mail de confirmation n’a pas pu être envoyé.',
            }
            : {
                success: 'Your LGS1920 Studio launch registration has been cancelled.',
                invalid: 'This cancellation link is invalid or has already been used.',
                mailFailure: 'Your registration was cancelled, but the confirmation email could not be sent.',
            }
        const headers = {
            'Cache-Control': 'no-store',
            'Content-Type':  'text/plain; charset=utf-8',
        }

        try {
            const revoked = await this.store.revoke(query?.id, query?.token)
            if (!revoked) {
                set.status = 404
                return new Response(messages.invalid, {status: 404, headers})
            }

            if (this.mailer) {
                await this.mailer.sendRevocation(revoked, locale)
            }

            return new Response(messages.success, {status: 200, headers})
        }
        catch (error) {
            if (error instanceof LaunchRegistrationStorageError) {
                set.status = 503
                return new Response('Launch registration cancellation is temporarily unavailable.', {status: 503, headers})
            }

            if (error instanceof ContactMailConfigurationError || error instanceof ContactMailDeliveryError) {
                set.status = 503
                return new Response(messages.mailFailure, {status: 503, headers})
            }

            set.status = 500
            return new Response('Unable to cancel launch registration.', {status: 500, headers})
        }
    }
}
