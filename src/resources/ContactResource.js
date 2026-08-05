import { ContactController } from '../controllers/ContactController.js'
import { ContactStore }      from '../services/ContactStore.js'

export const REGISTRATION_ROUTE = '/registration'

/**
 * Register the public Studio launch registration API on an Elysia application.
 */
export class ContactResource {
    /**
     * Register the contact submission route.
     *
     * @param {object} app Elysia application instance.
     * @param {object} options Resource configuration.
     * @param {ContactStore} [options.store] Injected store for tests or composition.
     * @param {string} [options.backendHome] Backend home used by the default store.
     */
    constructor(app, {store = null, backendHome = undefined} = {}) {
        if (!app) {
            throw new Error('app is undefined')
        }

        this.store = store ?? new ContactStore({backendHome})
        this.controller = new ContactController(this.store)

        app.post(REGISTRATION_ROUTE, this.controller.submit, {
            detail: {
                tags:     ['registration'],
                summary:  'Register for the Studio launch',
                description: 'Store a first name, last name, email address, and launch-contact consent from the public site.',
                body: {
                    type:                 'object',
                    required:             ['firstName', 'lastName', 'email', 'consent'],
                    additionalProperties: false,
                    properties: {
                        firstName: {type: 'string', maxLength: 80, example: 'Ada'},
                        lastName:  {type: 'string', maxLength: 80, example: 'Lovelace'},
                        email:     {type: 'string', format: 'email', maxLength: 254, example: 'ada@example.com'},
                        consent:   {type: 'boolean', enum: [true], example: true},
                        website:   {type: 'string', maxLength: 200, description: 'Anti-spam honeypot. Must remain empty.'},
                    },
                },
                responses: {
                    200: {description: 'Registration accepted'},
                    400: {description: 'Invalid registration payload'},
                    503: {description: 'Contact storage unavailable'},
                },
            },
        })
    }
}
