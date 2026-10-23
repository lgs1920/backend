import {
    ContactMailConfigurationError,
    ContactMailDeliveryError,
    ContactMailService,
    ContactMailValidationError,
    normalizeLaunchRegistrationMessage,
} from '../services/ContactMailService.js'
import {
    LaunchRegistrationDuplicateError,
    LaunchRegistrationNotPendingError,
    LaunchRegistrationPendingError,
    LaunchRegistrationResendCooldownError,
    LaunchRegistrationStorageError,
    LaunchRegistrationValidationError,
} from '../services/LaunchRegistrationStore.js'
import {getAllowedOrigins} from '../utils/BackendSecurity.js'
import {assertContactOrigin, ContactRequestSecurityError} from '../utils/ContactRequestSecurity.js'
import {ContactRateLimiter} from '../utils/ContactRateLimiter.js'

/**
 * Mask one email local-part or domain name while preserving its shape.
 *
 * @param {string} part Email local-part or domain name.
 * @returns {string} Masked part.
 */
const maskEmailPart = (part) => {
    const characters = [...part]
    if (characters.length === 0) {
        return '***'
    }
    if (characters.length === 1) {
        return `${characters[0]}*`
    }
    return `${characters[0]}${'*'.repeat(characters.length - 2)}${characters.at(-1)}`
}

/**
 * Mask an email address before returning it to a public confirmation page.
 *
 * @param {string} email Email address to mask.
 * @returns {string} Masked email address.
 */
const maskEmailAddress = (email) => {
    const [localPart, domainPart] = email.split('@')
    const suffixIndex = domainPart.lastIndexOf('.')
    const domainName = suffixIndex > 0 ? domainPart.slice(0, suffixIndex) : domainPart
    const domainSuffix = suffixIndex > 0 ? domainPart.slice(suffixIndex) : ''
    return `${maskEmailPart(localPart)}@${maskEmailPart(domainName)}${domainSuffix}`
}

/**
 * Build localized public messages for one launch-registration state.
 *
 * @param {*} locale Requested message locale.
 * @returns {{pending: string, resent: string, confirmed: string, confirmationUnavailable: string}} Localized messages.
 */
const getRegistrationMessages = (locale) => locale === 'fr'
    ? {
        pending:                   'Un e-mail de confirmation est déjà en attente.',
        resent:                    'Un nouvel e-mail de confirmation vient d’être envoyé.',
        confirmed:                 'Votre inscription est confirmée. Merci !',
        confirmationUnavailable:   'Votre inscription est confirmée, mais l’envoi de l’e-mail complémentaire est temporairement indisponible.',
    }
    : {
        pending:                   'A confirmation email is already pending.',
        resent:                    'A new confirmation email has been sent.',
        confirmed:                 'Your registration is confirmed. Thank you!',
        confirmationUnavailable:   'Your registration is confirmed, but the additional email is temporarily unavailable.',
    }

/**
 * Require the Site-rendered body or bodies needed for one launch-registration
 * delivery operation.
 *
 * @param {object} payload Normalized Site-rendered mail payload.
 * @param {object} [options] Delivery body requirements.
 * @param {boolean} [options.requireSupport=false] Whether a support body is required.
 * @param {'{{confirm-url}}'|'{{revoke-url}}'} [options.requiredPlaceholder='{{confirm-url}}'] URL placeholder required in the visitor body.
 * @returns {object} The validated payload.
 * @throws {ContactMailValidationError} If a required Site-rendered body is absent.
 */
const requireRenderedLaunchRegistrationMessages = (payload, {
    requireSupport = false,
    requiredPlaceholder = '{{confirm-url}}',
} = {}) => {
    if (!payload.renderedMessage) {
        throw new ContactMailValidationError('Rendered launch registration message is required')
    }
    if (!payload.renderedMessage.includes(requiredPlaceholder)) {
        throw new ContactMailValidationError(`Rendered launch registration message must contain ${requiredPlaceholder}`)
    }
    const forbiddenPlaceholder = requiredPlaceholder === '{{confirm-url}}'
        ? '{{revoke-url}}'
        : '{{confirm-url}}'
    if (payload.renderedMessage.includes(forbiddenPlaceholder)) {
        throw new ContactMailValidationError(`Rendered launch registration message must not contain ${forbiddenPlaceholder}`)
    }
    if (requireSupport && !payload.supportRenderedMessage) {
        throw new ContactMailValidationError('Rendered launch registration support message is required')
    }

    return payload
}

/**
 * Normalize fresh Site-rendered mail content against a persisted registration.
 *
 * The persisted identity and opaque target are authoritative; only the
 * transient rendered bodies come from the current Site request.
 *
 * @param {*} payload Raw Site request body.
 * @param {object} registration Persisted pending or confirmed registration.
 * @returns {object} Normalized mail payload.
 * @throws {ContactMailValidationError} If the Site payload is invalid.
 */
const createMailPayloadFromSite = (payload, registration) => normalizeLaunchRegistrationMessage({
    ...payload,
    to:        registration.mailTarget,
    form:      'launch-registration',
    locale:    registration.locale === 'fr' ? 'fr' : 'en',
    firstName: registration.firstName,
    lastName:  registration.lastName,
    email:     registration.email,
    consent:   true,
})

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
     * Apply one launch-registration rate limit.
     *
     * @param {'registration'|'registration-resend'|'registration-confirmation'} scope Rate-limit scope.
     * @param {object} context Elysia request context.
     * @param {object} set Elysia response configuration.
     * @param {string} message Public error returned when the limit is reached.
     * @returns {object|null} Public-safe response when limited, otherwise null.
     */
    checkRateLimit = (scope, context, set, message) => {
        const limited = this.rateLimiter.check(scope, context)
        if (!limited) {
            return null
        }

        set.status = 429
        set.headers['Retry-After'] = String(limited.retryAfterSeconds)
        return {success: false, error: message}
    }

    /**
     * Validate and persist one public registration in the pending state.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Public-safe response envelope.
     */
    register = async ({body, request, server, set}) => {
        let registrationId = null
        let storedRegistration = false
        try {
            assertContactOrigin(request.headers.get('origin'), this.allowedOrigins)

            if (await this.store.refresh()) {
                this.rateLimiter.reset('registration', {request, server})
            }
            const limited = this.checkRateLimit(
                'registration',
                {request, server, set},
                set,
                'Too many registration requests',
            )
            if (limited) {
                return limited
            }

            const honeypotFilled = typeof body?.website === 'string' && body.website.trim().length > 0
            const mailPayload = this.mailer && !honeypotFilled
                ? normalizeLaunchRegistrationMessage({...body, form: body?.form ?? 'launch-registration'})
                : null
            if (mailPayload) {
                requireRenderedLaunchRegistrationMessages(mailPayload)
            }
            if (mailPayload && !await this.store.hasRegistration(body?.email)) {
                this.mailer.getConfiguredAddresses(mailPayload.to)
            }

            const result = await this.store.register(body)
            registrationId = result.id ?? null
            storedRegistration = result.stored === true
            const {id, confirmationToken, ...publicResult} = result
            if (!this.mailer || !result.stored) {
                return publicResult
            }

            await this.mailer.sendConfirmation(mailPayload, {
                registrationId:   id,
                confirmationToken,
            })
            return {...publicResult, sent: true}
        }
        catch (error) {
            if (error instanceof ContactRequestSecurityError) {
                set.status = 403
                return {success: false, error: 'Registration request origin is not allowed'}
            }

            if (error instanceof LaunchRegistrationPendingError) {
                set.status = 409
                const messages = getRegistrationMessages(body?.locale === 'fr' ? 'fr' : 'en')
                return {
                    success:   false,
                    status:    'pending',
                    canResend: true,
                    error:     'Confirmation already pending',
                    message:   messages.pending,
                }
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
                if (storedRegistration && registrationId) {
                    try {
                        storedRegistration = !await this.store.removePendingRegistration(registrationId)
                    }
                    catch {
                        // Keep the stored flag truthful if rollback itself fails.
                    }
                }
                set.status = 503
                return {
                    success: false,
                    stored:  storedRegistration,
                    error:   'Launch registration confirmation email delivery is temporarily unavailable',
                }
            }

            set.status = 500
            return {success: false, error: 'Unable to save launch registration'}
        }
    }

    /**
     * Resend a pending launch-registration confirmation email.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Public-safe response envelope.
     */
    resendConfirmation = async ({body, request, server, set}) => {
        try {
            assertContactOrigin(request.headers.get('origin'), this.allowedOrigins)
            const limited = this.checkRateLimit(
                'registration-resend',
                {request, server, set},
                set,
                'Too many confirmation resend requests',
            )
            if (limited) {
                return limited
            }

            if (!this.mailer) {
                throw new ContactMailConfigurationError('Confirmation email delivery is not configured')
            }

            const pending = await this.store.getPendingRegistration(body?.email)
            const mailPayload = requireRenderedLaunchRegistrationMessages(createMailPayloadFromSite(body, pending))
            const updatedPending = await this.store.resendConfirmation(pending.email)
            const messages = getRegistrationMessages(updatedPending.locale === 'fr' ? 'fr' : 'en')
            await this.mailer.sendConfirmation(mailPayload, {
                registrationId:   updatedPending.id,
                confirmationToken: updatedPending.confirmationToken,
            })

            return {
                success: true,
                status:  'pending',
                resent:  true,
                message: messages.resent,
            }
        }
        catch (error) {
            if (error instanceof ContactRequestSecurityError) {
                set.status = 403
                return {success: false, error: 'Registration request origin is not allowed'}
            }

            if (error instanceof LaunchRegistrationResendCooldownError) {
                set.status = 429
                set.headers['Retry-After'] = String(error.retryAfterSeconds)
                return {success: false, error: 'Confirmation resend is temporarily unavailable'}
            }

            if (error instanceof LaunchRegistrationNotPendingError) {
                set.status = 404
                return {success: false, error: 'No pending confirmation found'}
            }

            if (error instanceof LaunchRegistrationValidationError) {
                set.status = 400
                return {success: false, error: error.message}
            }

            if (error instanceof LaunchRegistrationStorageError) {
                set.status = 503
                return {success: false, error: 'Pending launch registration is temporarily unavailable'}
            }

            if (error instanceof ContactMailValidationError) {
                set.status = 400
                return {success: false, error: error.message}
            }

            if (error instanceof ContactMailConfigurationError || error instanceof ContactMailDeliveryError) {
                set.status = 503
                return {success: false, error: 'Confirmation email delivery is temporarily unavailable'}
            }

            set.status = 500
            return {success: false, error: 'Unable to resend the launch registration confirmation'}
        }
    }

    /**
     * Read the private fields needed by the Site to render the final messages.
     * Possession of the single-use confirmation token is required.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Public-safe rendering context.
     */
    prepareConfirmation = async ({body, request, server, set}) => {
        try {
            assertContactOrigin(request.headers.get('origin'), this.allowedOrigins)
            const limited = this.checkRateLimit(
                'registration-confirmation',
                {request, server, set},
                set,
                'Too many confirmation requests',
            )
            if (limited) {
                return limited
            }

            const pending = await this.store.getPendingConfirmation(body?.id, body?.token)
            if (!pending) {
                set.status = 404
                return {success: false, error: 'Invalid or expired confirmation link'}
            }

            set.headers['Cache-Control'] = 'no-store'
            return {
                success:   true,
                status:    'pending',
                form:      'launch-registration',
                locale:    pending.locale === 'fr' ? 'fr' : 'en',
                firstName: pending.firstName,
                lastName:  pending.lastName,
                email:     pending.email,
            }
        }
        catch (error) {
            if (error instanceof ContactRequestSecurityError) {
                set.status = 403
                return {success: false, error: 'Registration request origin is not allowed'}
            }

            if (error instanceof LaunchRegistrationStorageError) {
                set.status = 503
                return {success: false, error: 'Launch registration confirmation is temporarily unavailable'}
            }

            set.status = 500
            return {success: false, error: 'Unable to prepare launch registration confirmation'}
        }
    }

    /**
     * Confirm one pending launch registration and expose its masked email address.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Public-safe confirmation response envelope.
     */
    confirm = async ({body, request, server, set}) => {
        try {
            assertContactOrigin(request.headers.get('origin'), this.allowedOrigins)
            const limited = this.checkRateLimit(
                'registration-confirmation',
                {request, server, set},
                set,
                'Too many confirmation requests',
            )
            if (limited) {
                return limited
            }

            const confirmed = await this.store.confirm(body?.id, body?.token)
            if (!confirmed) {
                set.status = 404
                return {success: false, error: 'Invalid or expired confirmation link'}
            }

            const locale = confirmed.locale === 'fr' ? 'fr' : 'en'
            const messages = getRegistrationMessages(locale)
            const response = {
                success: true,
                status:  'confirmed',
                email:   maskEmailAddress(confirmed.email),
                message: messages.confirmed,
                sent:    false,
            }
            set.headers['Cache-Control'] = 'no-store'

            if (!this.mailer) {
                return response
            }

            try {
                const mailPayload = requireRenderedLaunchRegistrationMessages(
                    createMailPayloadFromSite(body, confirmed),
                    {requireSupport: true, requiredPlaceholder: '{{revoke-url}}'},
                )
                await this.mailer.send(mailPayload, {
                    form:             'launch-registration',
                    registrationId:   confirmed.id,
                    cancellationToken: confirmed.cancellationToken,
                })
                response.sent = true
            }
            catch (error) {
                if (!(error instanceof ContactMailConfigurationError)
                    && !(error instanceof ContactMailDeliveryError)
                    && !(error instanceof ContactMailValidationError)) {
                    throw error
                }
                response.warning = messages.confirmationUnavailable
            }

            return response
        }
        catch (error) {
            if (error instanceof ContactRequestSecurityError) {
                set.status = 403
                return {success: false, error: 'Registration request origin is not allowed'}
            }

            if (error instanceof LaunchRegistrationStorageError) {
                set.status = 503
                return {success: false, error: 'Launch registration confirmation is temporarily unavailable'}
            }

            set.status = 500
            return {success: false, error: 'Unable to confirm launch registration'}
        }
    }

    /**
     * Revoke one confirmed launch registration from its private email link.
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
            }
            : {
                success: 'Your LGS1920 Studio launch registration has been cancelled.',
                invalid: 'This cancellation link is invalid or has already been used.',
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

            return new Response(JSON.stringify({
                success: true,
                email:   maskEmailAddress(revoked.email),
                message: messages.success,
            }), {
                status:  200,
                headers: {...headers, 'Content-Type': 'application/json; charset=utf-8'},
            })
        }
        catch (error) {
            if (error instanceof LaunchRegistrationStorageError) {
                set.status = 503
                return new Response('Launch registration cancellation is temporarily unavailable.', {status: 503, headers})
            }

            set.status = 500
            return new Response('Unable to cancel launch registration.', {status: 500, headers})
        }
    }
}
