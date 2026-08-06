import {ContactMailController} from '../controllers/ContactMailController.js'
import {ContactMailService} from '../services/ContactMailService.js'

export const CONTACT_ROUTE = '/contact'

/** Register the public contact form email API on an Elysia application. */
export class ContactMailResource {
    /**
     * @param {object} app Elysia application instance.
     * @param {object} options Resource configuration.
     * @param {ContactMailService} [options.mailer] Injected mail service for tests or composition.
     */
    constructor(app, {mailer = null} = {}) {
        if (!app) {
            throw new Error('app is undefined')
        }

        this.mailer = mailer ?? new ContactMailService()
        this.controller = new ContactMailController(this.mailer)

        app.post(CONTACT_ROUTE, this.controller.send, {
            detail: {
                tags:     ['contact'],
                summary:  'Send a contact message',
                description: 'Validate a public contact form submission and send it through the configured SMTP relay.',
                body: {
                    type:                 'object',
                    required:             ['firstName', 'lastName', 'email', 'subject', 'message', 'consent'],
                    additionalProperties: false,
                    properties: {
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
                    503: {description: 'Contact email delivery unavailable'},
                },
            },
        })
    }
}
