import {ContactMailController} from '../controllers/ContactMailController.js'
import {ContactMailService} from '../services/ContactMailService.js'
import {ContactRateLimiter} from '../utils/ContactRateLimiter.js'

export const CONTACT_ROUTE = '/contact'
export const CONTACT_TOKEN_ROUTE = `${CONTACT_ROUTE}/token`

/** Register the public contact form email API on an Elysia application. */
export class ContactMailResource {
    /**
     * @param {object} app Elysia application instance.
     * @param {object} options Resource configuration.
     * @param {ContactMailService} [options.mailer] Injected mail service for tests or composition.
     * @param {string[]} [options.allowedOrigins] Exact browser origins allowed to submit the form.
     * @param {string} [options.csrfSecret] Server-only secret used to sign contact form tokens.
     * @param {ContactRateLimiter} [options.rateLimiter] In-memory contact request limiter.
     */
    constructor(app, {
        mailer = null,
        allowedOrigins = undefined,
        csrfSecret = undefined,
        rateLimiter = new ContactRateLimiter({
            trustProxy: process.env.LGS1920_TRUST_PROXY === 'true',
        }),
    } = {}) {
        if (!app) {
            throw new Error('app is undefined')
        }

        this.mailer = mailer ?? new ContactMailService()
        this.controller = new ContactMailController(this.mailer, {allowedOrigins, csrfSecret, rateLimiter})

        app.get(CONTACT_TOKEN_ROUTE, this.controller.issueToken, {
            detail: {
                tags:     ['contact'],
                summary:  'Issue a contact form token',
                description: 'Issue a short-lived token for an allowed contact form origin.',
                responses: {
                    200: {description: 'Contact form token issued'},
                    403: {description: 'Contact form origin not allowed'},
                    503: {description: 'Contact request security unavailable'},
                },
            },
        })

        app.post(CONTACT_ROUTE, this.controller.send, {
            detail: {
                tags:     ['contact'],
                summary:  'Send a contact message',
                description: 'Validate a public contact form submission and send it through the configured SMTP relay.',
                body: {
                    type:                 'object',
                    required:             ['to', 'csrfToken', 'firstName', 'lastName', 'email', 'subject', 'message', 'consent'],
                    additionalProperties: false,
                    properties: {
                        to:        {type: 'string', minLength: 4, maxLength: 64, example: 'f7a91c'},
                        csrfToken: {type: 'string', minLength: 32, description: 'Short-lived token issued by GET /contact/token.'},
                        firstName: {type: 'string', maxLength: 80, example: 'Ada'},
                        lastName:  {type: 'string', maxLength: 80, example: 'Lovelace'},
                        email:     {type: 'string', format: 'email', maxLength: 254, example: 'ada@example.com'},
                        subject:   {type: 'string', maxLength: 160, example: 'Studio question'},
                        message:   {type: 'string', maxLength: 5000, example: 'I would like to know more about Studio.'},
                        consent:   {type: 'boolean', enum: [true], example: true},
                        website:   {type: 'string', maxLength: 200, description: 'Anti-spam honeypot. Must remain empty.'},
                    },
                },
                responses: {
                    200: {description: 'Contact message sent'},
                    400: {description: 'Invalid contact payload'},
                    429: {description: 'Contact rate limit exceeded'},
                    503: {description: 'Contact email delivery unavailable'},
                },
            },
        })
    }
}
