import { LaunchRegistrationController } from '../controllers/LaunchRegistrationController.js'
import { LaunchRegistrationStore }      from '../services/LaunchRegistrationStore.js'
import {ContactMailService} from '../services/ContactMailService.js'
import {getAllowedOrigins} from '../utils/BackendSecurity.js'
import {ContactRateLimiter} from '../utils/ContactRateLimiter.js'

export const LAUNCH_REGISTRATION_ROUTE = '/launch-registration'
export const LAUNCH_REGISTRATION_REVOKE_ROUTE = `${LAUNCH_REGISTRATION_ROUTE}/revoke`

/**
 * Register the public Studio launch registration API on an Elysia application.
 */
export class LaunchRegistrationResource {
    /**
     * Register the launch registration submission route.
     *
     * @param {object} app Elysia application instance.
     * @param {object} options Resource configuration.
     * @param {LaunchRegistrationStore} [options.store] Injected store for tests or composition.
     * @param {string} [options.backendHome] Backend home used by the default store.
     * @param {string[]} [options.allowedOrigins] Exact browser origins allowed to submit registrations.
     * @param {ContactMailService|null} [options.mailer] Optional shared form mail transport.
     * @param {ContactRateLimiter} [options.rateLimiter] Injected public registration limiter.
     */
    constructor(app, {
        allowedOrigins = getAllowedOrigins(),
        mailer = null,
        store = null,
        backendHome = undefined,
        rateLimiter = new ContactRateLimiter({
            trustProxy: process.env.LGS1920_TRUST_PROXY === 'true',
        }),
    } = {}) {
        if (!app) {
            throw new Error('app is undefined')
        }

        this.store = store ?? new LaunchRegistrationStore({backendHome})
        this.controller = new LaunchRegistrationController(this.store, {allowedOrigins, mailer, rateLimiter})

        app.post(LAUNCH_REGISTRATION_ROUTE, this.controller.register, {
            detail: {
                tags:     ['launch-registration'],
                summary:  'Register for the Studio launch',
                description: 'Validate and store a launch registration, optionally sending the rendered form message through the shared SMTP relay.',
                body: {
                    type:                 'object',
                    required:             ['form', 'locale', 'firstName', 'lastName', 'email', 'consent'],
                    additionalProperties: false,
                    properties: {
                        to:            {type: 'string', minLength: 4, maxLength: 64, example: 'f7a91c', description: 'Opaque server-side contact target key used when email delivery is enabled.'},
                        form:          {type: 'string', enum: ['launch-registration'], default: 'launch-registration'},
                        locale:        {type: 'string', enum: ['en', 'fr']},
                        renderedMessage: {type: 'string', maxLength: 20000, description: 'Rendered site-catalog message. Backend uses a generic envelope when omitted.'},
                        firstName: {type: 'string', maxLength: 80, example: 'Ada'},
                        lastName:  {type: 'string', maxLength: 80, example: 'Lovelace'},
                        email:     {type: 'string', format: 'email', maxLength: 254, example: 'ada@example.com'},
                        consent:   {type: 'boolean', enum: [true], example: true},
                        website:   {type: 'string', maxLength: 200, description: 'Anti-spam honeypot. Must remain empty.'},
                    },
                },
                responses: {
                    200: {description: 'Registration accepted and optionally emailed'},
                    400: {description: 'Invalid registration payload'},
                    403: {description: 'Registration request origin not allowed'},
                    409: {description: 'Email address already registered'},
                    429: {description: 'Registration rate limit exceeded'},
                    503: {description: 'Launch registration storage or email delivery unavailable'},
                },
            },
        })

        app.get(LAUNCH_REGISTRATION_REVOKE_ROUTE, this.controller.revoke, {
            detail: {
                tags:     ['launch-registration'],
                summary:  'Cancel a launch registration',
                description: 'Cancel a launch registration with the single-purpose token sent in its confirmation email.',
                query: {
                    type:                 'object',
                    required:             ['id', 'token'],
                    additionalProperties: false,
                    properties: {
                        id:     {type: 'string', minLength: 1, maxLength: 64},
                        token:  {type: 'string', minLength: 40, maxLength: 128},
                        locale: {type: 'string', enum: ['en', 'fr'], default: 'en'},
                    },
                },
                responses: {
                    200: {description: 'Registration cancelled'},
                    404: {description: 'Invalid or already used cancellation link'},
                    503: {description: 'Registration storage unavailable'},
                },
            },
        })
    }
}
