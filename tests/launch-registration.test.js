import { Elysia } from 'elysia'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LaunchRegistrationResource } from '../src/resources/LaunchRegistrationResource.js'
import { LaunchRegistrationStore } from '../src/services/LaunchRegistrationStore.js'
import {ContactMailService} from '../src/services/ContactMailService.js'
import {ContactRateLimiter} from '../src/utils/ContactRateLimiter.js'

const homes = []
const allowedOrigin = 'https://registration.test'

/**
 * Create an isolated launch registration application backed by a temporary directory.
 *
 * @param {object} [options] Test options.
 * @param {ContactMailService|null} [options.mailer] Optional shared form mail transport.
 * @param {number} [options.registrationLimit=100] Registration rate limit.
 * @returns {Promise<{app: Elysia, store: LaunchRegistrationStore, home: string}>} Test context.
 */
const createContext = async ({mailer = null, registrationLimit = 100} = {}) => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'lgs1920-launch-registration-'))
    homes.push(home)
    const store = new LaunchRegistrationStore({
        backendHome: home,
        clock:      () => new Date('2026-08-05T12:00:00.000Z'),
    })
    await store.ready

    const app = new Elysia()
    new LaunchRegistrationResource(app, {
        allowedOrigins: [allowedOrigin],
        mailer,
        store,
        rateLimiter: new ContactRateLimiter({
            registrationLimit,
            getClientKey: () => 'test-client',
        }),
    })

    return {app, store, home}
}

/**
 * Send a JSON request to an in-memory Elysia application.
 *
 * @param {Elysia} app Application under test.
 * @param {*} body JSON request body.
 * @returns {Promise<Response>} Application response.
 */
const request = (app, body, origin = allowedOrigin) => app.handle(new Request('http://registration.test/launch-registration', {
    method:  'POST',
    headers: {
        'Content-Type': 'application/json',
        Origin:         origin,
    },
    body:    JSON.stringify({
        form:   'launch-registration',
        locale: 'en',
        ...body,
    }),
}))

afterEach(async () => {
    await Promise.all(homes.splice(0).map(home => rm(home, {recursive: true, force: true})))
})

describe('launch registration API', () => {
    test('stores a valid registration without returning personal data', async () => {
        const {app, home} = await createContext()

        const response = await request(app, {
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     ' ADA@example.com ',
            consent:   true,
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({success: true, stored: true})

        const persisted = JSON.parse(await readFile(path.join(home, 'data', 'launch-registrations.json'), 'utf8'))
        expect(persisted.schemaVersion).toBe(1)
        expect(persisted.registrations).toHaveLength(1)
        expect(persisted.registrations[0]).toMatchObject({
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   true,
            createdAt: '2026-08-05T12:00:00.000Z',
        })
        expect(persisted.registrations[0].id).toBeString()
    })

    test('sends a rendered launch-registration message through the shared mail transport', async () => {
        const messages = []
        const mailer = new ContactMailService({
            env: {
                LGS1920_CONTACT_TARGET_F7A91C: 'studio@lgs1920.fr',
            },
            transporter: {
                sendMail: async (message) => messages.push(message),
            },
        })
        const {app} = await createContext({mailer})

        const response = await request(app, {
            to:             'f7a91c',
            form:           'launch-registration',
            locale:         'fr',
            firstName:      'Ada',
            lastName:       'Lovelace',
            email:          'ada@example.com',
            consent:        true,
            renderedMessage: 'Bonjour, Ada souhaite être informée du lancement.',
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({success: true, stored: true, sent: true})
        expect(messages).toHaveLength(1)
        expect(messages[0].text).toContain('Bonjour, Ada souhaite être informée du lancement.')
        expect(messages[0].text).toEndWith('![LGS1920 Studio](https://lgs1920.fr/assets/logo/logo-horizontal.png)')
        expect(messages[0].replyTo).toBe('ada@example.com')
    })

    test('rejects an invalid launch mail contract before persisting', async () => {
        const mailer = new ContactMailService({
            env: {
                LGS1920_CONTACT_TARGET_F7A91C: 'studio@lgs1920.fr',
            },
            transporter: {
                sendMail: async () => undefined,
            },
        })
        const {app, home} = await createContext({mailer})

        const response = await request(app, {
            to:             'f7a91c',
            form:           'contact',
            firstName:      'Ada',
            lastName:       'Lovelace',
            email:          'ada@example.com',
            consent:        true,
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({success: false, error: 'Unsupported form identifier'})
        await expect(readFile(path.join(home, 'data', 'launch-registrations.json'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'})
    })

    test('rejects invalid registrations', async () => {
        const {app} = await createContext()

        const missingConsent = await request(app, {
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   false,
        })
        expect(missingConsent.status).toBe(400)
        expect(await missingConsent.json()).toEqual({success: false, error: 'Consent is required'})

        const invalidEmail = await request(app, {
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'not-an-email',
            consent:   true,
        })
        expect(invalidEmail.status).toBe(400)
        expect(await invalidEmail.json()).toEqual({success: false, error: 'Invalid email address'})
    })

    test('rejects registrations from an unlisted origin', async () => {
        const {app} = await createContext()

        const response = await request(app, {
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   true,
        }, 'https://untrusted.test')

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({success: false, error: 'Registration request origin is not allowed'})
    })

    test('keeps email registration unique after normalization', async () => {
        const {app, home} = await createContext()

        const first = await request(app, {
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   true,
        })
        const duplicate = await request(app, {
            firstName: 'Augusta',
            lastName:  'King',
            email:     ' ADA@EXAMPLE.COM ',
            consent:   true,
        })

        expect(first.status).toBe(200)
        expect(duplicate.status).toBe(409)
        expect(await duplicate.json()).toEqual({success: false, error: 'Already registered'})

        const persisted = JSON.parse(await readFile(path.join(home, 'data', 'launch-registrations.json'), 'utf8'))
        expect(persisted.registrations).toHaveLength(1)
    })

    test('limits repeated registration requests per client', async () => {
        const {app} = await createContext({registrationLimit: 2})
        const payload = index => ({
            firstName: `First${index}`,
            lastName:  'Test',
            email:     `person${index}@example.com`,
            consent:   true,
        })

        expect((await request(app, payload(1))).status).toBe(200)
        expect((await request(app, payload(2))).status).toBe(200)

        const limited = await request(app, payload(3))
        expect(limited.status).toBe(429)
        expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/)
        expect(await limited.json()).toEqual({success: false, error: 'Too many registration requests'})
    })

    test('silently accepts honeypot submissions without storing them', async () => {
        const {app, home} = await createContext()

        const response = await request(app, {
            firstName: 'Bot',
            lastName:  'User',
            email:     'bot@example.com',
            consent:   true,
            website:   'https://spam.example.com',
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({success: true, stored: false})
        await expect(readFile(path.join(home, 'data', 'launch-registrations.json'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'})
    })

    test('serializes concurrent registrations', async () => {
        const {app, home} = await createContext()

        await Promise.all(Array.from({length: 40}, (_, index) => request(app, {
            firstName: `First${index}`,
            lastName:  'Test',
            email:     `person${index}@example.com`,
            consent:   true,
        })))

        const persisted = JSON.parse(await readFile(path.join(home, 'data', 'launch-registrations.json'), 'utf8'))
        expect(persisted.registrations).toHaveLength(40)
    })
})
