import { LaunchRegistrationController } from '../controllers/LaunchRegistrationController.js'
import { LaunchRegistrationStore }      from '../services/LaunchRegistrationStore.js'
import {ContactMailService} from '../services/ContactMailService.js'
import {getAllowedOrigins} from '../utils/BackendSecurity.js'
import {ContactRateLimiter} from '../utils/ContactRateLimiter.js'

export const LAUNCH_REGISTRATION_ROUTE = '/launch-registration'
export const LAUNCH_REGISTRATION_CONFIRM_DETAILS_ROUTE = `${LAUNCH_REGISTRATION_ROUTE}/confirm-details`
export const LAUNCH_REGISTRATION_CONFIRM_ROUTE = `${LAUNCH_REGISTRATION_ROUTE}/confirm`
export const LAUNCH_REGISTRATION_RESEND_ROUTE = `${LAUNCH_REGISTRATION_ROUTE}/resend-confirmation`
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
     * @param {string} [options.registrationFile] Explicit launch-registration storage path.
     * @param {string} [options.pendingRegistrationFile] Explicit pending-registration storage path.
     * @param {string[]} [options.allowedOrigins] Exact browser origins allowed to submit registrations.
     * @param {ContactMailService|null} [options.mailer] Optional shared form mail transport.
     * @param {ContactRateLimiter} [options.rateLimiter] Injected public registration limiter.
     */
    constructor(app, {
        allowedOrigins = getAllowedOrigins(),
        mailer = null,
        store = null,
        backendHome = undefined,
        registrationFile = undefined,
        pendingRegistrationFile = undefined,
        rateLimiter = new ContactRateLimiter({
            trustProxy: process.env.LGS1920_TRUST_PROXY === 'true',
        }),
    } = {}) {
        if (!app) {
            throw new Error('app is undefined')
        }

        this.store = store ?? new LaunchRegistrationStore({
            backendHome,
            filePath:        process.env.LGS1920_REGISTRATION_FILE || registrationFile,
            pendingFilePath: process.env.LGS1920_PENDING_REGISTRATION_FILE || pendingRegistrationFile,
        })
        this.controller = new LaunchRegistrationController(this.store, {allowedOrigins, mailer, rateLimiter})

        app.post(LAUNCH_REGISTRATION_ROUTE, this.controller.register, {
            detail: {
                tags:     ['launch-registration'],
                summary:  'Register for the Studio launch',
                description: 'Validate a launch registration, store it pending confirmation, and send a single-use confirmation email through the shared SMTP relay.',
                body: {
                    type:                 'object',
                    required:             ['form', 'locale', 'firstName', 'lastName', 'email', 'consent'],
                    additionalProperties: false,
                    properties: {
                        to:            {type: 'string', minLength: 4, maxLength: 64, example: 'f7a91c', description: 'Opaque server-side contact target key used when email delivery is enabled.'},
                        form:          {type: 'string', enum: ['launch-registration'], default: 'launch-registration'},
                        locale:        {type: 'string', enum: ['en', 'fr']},
                        renderedMessage:        {type: 'string', maxLength: 20000, description: 'Rendered site acknowledgement template for the visitor.'},
                        supportRenderedMessage: {type: 'string', maxLength: 20000, description: 'Rendered site notification template for the Studio mailbox.'},
                        firstName: {type: 'string', maxLength: 80, example: 'Ada'},
                        lastName:  {type: 'string', maxLength: 80, example: 'Lovelace'},
                        email:     {type: 'string', format: 'email', maxLength: 254, example: 'ada@example.com'},
                        consent:   {type: 'boolean', enum: [true], example: true},
                        website:   {type: 'string', maxLength: 200, description: 'Anti-spam honeypot. Must remain empty.'},
                    },
                },
                responses: {
                    200: {description: 'Registration stored pending email confirmation'},
                    400: {description: 'Invalid registration payload'},
                    403: {description: 'Registration request origin not allowed'},
                    409: {description: 'Email address already registered or confirmation already pending'},
                    429: {description: 'Registration rate limit exceeded'},
                    503: {description: 'Launch registration storage or email delivery unavailable'},
                },
            },
        })

        app.post(LAUNCH_REGISTRATION_CONFIRM_DETAILS_ROUTE, this.controller.prepareConfirmation, {
            detail: {
                tags:     ['launch-registration'],
                summary:  'Prepare a launch registration confirmation',
                description: 'Validate a single-use confirmation token and return the private fields required by the Site to render the follow-up messages. The token is not consumed by this request.',
                body: {
                    type:                 'object',
                    required:             ['id', 'token'],
                    additionalProperties: false,
                    properties: {
                        id:    {type: 'string', minLength: 1, maxLength: 64},
                        token: {type: 'string', minLength: 40, maxLength: 128},
                    },
                },
                responses: {
                    200: {description: 'Confirmation rendering context returned'},
                    403: {description: 'Confirmation request origin not allowed'},
                    404: {description: 'Invalid or expired confirmation link'},
                    429: {description: 'Confirmation rate limit exceeded'},
                    503: {description: 'Registration confirmation unavailable'},
                },
            },
        })

        app.post(LAUNCH_REGISTRATION_CONFIRM_ROUTE, this.controller.confirm, {
            detail: {
                tags:     ['launch-registration'],
                summary:  'Confirm a launch registration',
                description: 'Consume a single-use confirmation token, move the pending registration to the confirmed file, and return the visitor email in masked form.',
                body: {
                    type:                 'object',
                    required:             ['id', 'token'],
                    additionalProperties: false,
                    properties: {
                        id:                   {type: 'string', minLength: 1, maxLength: 64},
                        token:                {type: 'string', minLength: 40, maxLength: 128},
                        renderedMessage:      {type: 'string', maxLength: 20000, description: 'Fresh Site-rendered final acknowledgement containing the {{revoke-url}} placeholder.'},
                        supportRenderedMessage: {type: 'string', maxLength: 20000, description: 'Fresh Site-rendered confirmed-registration notification.'},
                    },
                },
                responses: {
                    200: {description: 'Registration confirmed'},
                    403: {description: 'Confirmation request origin not allowed'},
                    404: {description: 'Invalid or expired confirmation link'},
                    429: {description: 'Confirmation rate limit exceeded'},
                    503: {description: 'Registration confirmation unavailable'},
                },
            },
        })

        app.post(LAUNCH_REGISTRATION_RESEND_ROUTE, this.controller.resendConfirmation, {
            detail: {
                tags:     ['launch-registration'],
                summary:  'Resend a launch registration confirmation email',
                description: 'Rotate the pending registration confirmation token and send a new confirmation email.',
                body: {
                    type:                 'object',
                    required:             ['email'],
                    additionalProperties: false,
                    properties: {
                        email:                  {type: 'string', format: 'email', maxLength: 254, example: 'ada@example.com'},
                        to:                     {type: 'string', minLength: 4, maxLength: 64, example: 'f7a91c', description: 'Opaque server-side contact target key.'},
                        form:                   {type: 'string', enum: ['launch-registration'], default: 'launch-registration'},
                        locale:                 {type: 'string', enum: ['en', 'fr']},
                        renderedMessage:         {type: 'string', maxLength: 20000, description: 'Fresh Site-rendered confirmation message containing the {{confirm-url}} placeholder.'},
                        supportRenderedMessage:  {type: 'string', maxLength: 20000, description: 'Accepted for contract symmetry but not used by the confirmation-only resend.'},
                        firstName:               {type: 'string', maxLength: 80, example: 'Ada'},
                        lastName:                {type: 'string', maxLength: 80, example: 'Lovelace'},
                        consent:                 {type: 'boolean', enum: [true], example: true},
                    },
                },
                responses: {
                    200: {description: 'Confirmation email resent'},
                    400: {description: 'Invalid email address'},
                    403: {description: 'Resend request origin not allowed'},
                    404: {description: 'No pending confirmation found'},
                    429: {description: 'Confirmation resend rate limit exceeded'},
                    503: {description: 'Confirmation email delivery unavailable'},
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
