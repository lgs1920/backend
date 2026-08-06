import { LaunchRegistrationController } from '../controllers/LaunchRegistrationController.js'
import { LaunchRegistrationStore }      from '../services/LaunchRegistrationStore.js'
import {ContactRateLimiter} from '../utils/ContactRateLimiter.js'

export const LAUNCH_REGISTRATION_ROUTE = '/launch-registration'

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
     * @param {ContactRateLimiter} [options.rateLimiter] Injected public registration limiter.
     */
    constructor(app, {
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
        this.controller = new LaunchRegistrationController(this.store, {rateLimiter})

        app.post(LAUNCH_REGISTRATION_ROUTE, this.controller.register, {
            detail: {
                tags:     ['launch-registration'],
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
                    429: {description: 'Registration rate limit exceeded'},
                    503: {description: 'Launch registration storage unavailable'},
                },
            },
        })
    }
}
