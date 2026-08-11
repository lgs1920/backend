import { Elysia } from 'elysia'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LaunchRegistrationResource } from '../src/resources/LaunchRegistrationResource.js'
import { LaunchRegistrationStore } from '../src/services/LaunchRegistrationStore.js'
import {ContactMailService} from '../src/services/ContactMailService.js'
import {ContactRateLimiter} from '../src/utils/ContactRateLimiter.js'

const homes = []
const allowedOrigin = 'https://registration.test'
const initialDate = '2026-08-05T12:00:00.000Z'

/**
 * Create an isolated launch registration application backed by a temporary directory.
 *
 * @param {object} [options] Test options.
 * @param {ContactMailService|null} [options.mailer] Optional shared form mail transport.
 * @param {number} [options.registrationLimit=100] Initial-registration rate limit.
 * @param {number} [options.registrationResendLimit=100] Confirmation-resend rate limit.
 * @param {number} [options.registrationConfirmationLimit=100] Confirmation rate limit.
 * @param {() => Date} [options.clock] Store clock.
 * @returns {Promise<{app: Elysia, store: LaunchRegistrationStore, home: string}>} Test context.
 */
const createContext = async ({
    mailer = null,
    registrationLimit = 100,
    registrationResendLimit = 100,
    registrationConfirmationLimit = 100,
    clock = () => new Date(initialDate),
} = {}) => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'lgs1920-launch-registration-'))
    homes.push(home)
    const store = new LaunchRegistrationStore({
        backendHome: home,
        clock,
    })
    await store.ready

    const app = new Elysia()
    new LaunchRegistrationResource(app, {
        allowedOrigins: [allowedOrigin],
        mailer,
        store,
        rateLimiter: new ContactRateLimiter({
            registrationLimit,
            registrationResendLimit,
            registrationConfirmationLimit,
            getClientKey: () => 'test-client',
        }),
    })

    return {app, store, home}
}

/**
 * Send a JSON launch-registration submission to an in-memory Elysia application.
 *
 * @param {Elysia} app Application under test.
 * @param {*} body JSON request body.
 * @param {string} [origin] Browser origin.
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
        renderedMessage:        'Confirm your registration\n{{confirm-url}}',
        supportRenderedMessage: 'New launch registration.',
        ...body,
    }),
}))

/**
 * Send a confirmation request to an in-memory Elysia application.
 *
 * @param {Elysia} app Application under test.
 * @param {{id: string, token: string}} body Confirmation credentials.
 * @param {string} [origin] Browser origin.
 * @returns {Promise<Response>} Application response.
 */
const confirmRequest = (app, body, origin = allowedOrigin) => app.handle(new Request('http://registration.test/launch-registration/confirm', {
    method:  'POST',
    headers: {
        'Content-Type': 'application/json',
        Origin:         origin,
    },
    body:    JSON.stringify({
        renderedMessage:        'Votre inscription est confirmée.\n\n[Demander l’annulation de l’inscription]({{revoke-url}})\n\nCordialement',
        supportRenderedMessage: 'Inscription confirmée.',
        ...body,
    }),
}))

/**
 * Validate a confirmation token and read the transient Site-rendering context.
 *
 * @param {Elysia} app Application under test.
 * @param {{id: string, token: string}} body Confirmation credentials.
 * @param {string} [origin] Browser origin.
 * @returns {Promise<Response>} Application response.
 */
const confirmDetailsRequest = (app, body, origin = allowedOrigin) => app.handle(new Request('http://registration.test/launch-registration/confirm-details', {
    method:  'POST',
    headers: {
        'Content-Type': 'application/json',
        Origin:         origin,
    },
    body:    JSON.stringify(body),
}))

/**
 * Send a confirmation-resend request to an in-memory Elysia application.
 *
 * @param {Elysia} app Application under test.
 * @param {{email: string}} body Resend request body.
 * @param {string} [origin] Browser origin.
 * @returns {Promise<Response>} Application response.
 */
const resendRequest = (app, body, origin = allowedOrigin) => app.handle(new Request('http://registration.test/launch-registration/resend-confirmation', {
    method:  'POST',
    headers: {
        'Content-Type': 'application/json',
        Origin:         origin,
    },
    body:    JSON.stringify({
        renderedMessage: 'Confirm your registration\n{{confirm-url}}',
        ...body,
    }),
}))

/**
 * Read a persisted registration envelope.
 *
 * @param {string} filePath Registration file path.
 * @returns {Promise<object>} Parsed registration envelope.
 */
const readRegistrationFile = async filePath => JSON.parse(await readFile(filePath, 'utf8'))

/**
 * Extract the first confirmation URL from a delivered message.
 *
 * @param {object} message Delivered email message.
 * @returns {URL} Parsed confirmation URL.
 */
const extractConfirmationUrl = message => new URL(message.text.match(/https:\/\/site\.test\/[^\s)]+/u)?.[0])

afterEach(async () => {
    await Promise.all(homes.splice(0).map(home => rm(home, {recursive: true, force: true})))
})

describe('launch registration API', () => {
    test('uses explicit confirmed and derived pending registration files', async () => {
        const home = await mkdtemp(path.join(os.tmpdir(), 'lgs1920-launch-registration-configured-'))
        homes.push(home)
        const registrationFile = path.join(home, 'shared', 'launch-registrations.json')
        const app = new Elysia()
        const resource = new LaunchRegistrationResource(app, {
            allowedOrigins: [allowedOrigin],
            registrationFile,
        })

        await resource.store.ready

        expect(resource.store.filePath).toBe(registrationFile)
        expect(resource.store.pendingFilePath).toBe(path.join(home, 'shared', 'launch-registrations-pending.json'))
    })

    test('stores a valid registration in the pending file without returning personal data', async () => {
        const {app, home} = await createContext()

        const response = await request(app, {
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     ' ADA@example.com ',
            consent:   true,
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({success: true, stored: true, status: 'pending', confirmationRequired: true})

        const pending = await readRegistrationFile(path.join(home, 'data', 'launch-registrations-pending.json'))
        expect(pending.schemaVersion).toBe(3)
        expect(pending.registrations).toHaveLength(1)
        expect(pending.registrations[0]).toMatchObject({
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   true,
            createdAt: '2026-08-05T12:00:00.000Z',
            locale:    'en',
        })
        expect(pending.registrations[0].id).toBeString()
        expect(pending.registrations[0].confirmationTokenHash).toMatch(/^[a-f0-9]{64}$/u)
        await expect(readFile(path.join(home, 'data', 'launch-registrations.json'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'})
    })

    test('sends one localized confirmation email with a site confirmation URL', async () => {
        const messages = []
        const mailer = new ContactMailService({
            sitePublicUrl: 'https://site.test',
            env: {
                LGS1920_CONTACT_TARGET_F7A91C: 'studio@lgs1920.fr',
            },
            transporter: {
                sendMail: async (message) => messages.push(message),
            },
        })
        const {app, home} = await createContext({mailer})

        const response = await request(app, {
            to:             'f7a91c',
            form:           'launch-registration',
            locale:         'fr',
            firstName:      'Ada',
            lastName:       'Lovelace',
            email:          'ada@example.com',
            consent:        true,
            renderedMessage: 'Bonjour Ada\n{{confirm-url}}',
            supportRenderedMessage: 'Nouvelle inscription pour Studio.',
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({success: true, stored: true, status: 'pending', confirmationRequired: true, sent: true})
        expect(messages).toHaveLength(1)
        expect(messages[0]).toMatchObject({
            from:    {
                name:    'LGS1920 Studio',
                address: 'studio@lgs1920.fr',
            },
            to:      {
                name:    'Ada Lovelace',
                address: 'ada@example.com',
            },
            replyTo: 'studio@lgs1920.fr',
            subject: '[LGS1920] Confirmez votre inscription',
        })
        expect(messages[0].text).toContain('Bonjour Ada')
        expect(messages[0].text).toContain('https://site.test/fr/registration/confirm/?id=')
        expect(messages[0].text).not.toContain('{{confirm-url}}')
        const pending = await readRegistrationFile(path.join(home, 'data', 'launch-registrations-pending.json'))
        expect(pending.registrations[0].renderedMessage).toBeUndefined()
        expect(pending.registrations[0].supportRenderedMessage).toBeUndefined()
    })

    test('rolls back the pending registration when confirmation email delivery fails', async () => {
        const mailer = new ContactMailService({
            sitePublicUrl: 'https://site.test',
            env: {
                LGS1920_CONTACT_TARGET_F7A91C: 'studio@lgs1920.fr',
            },
            transporter: {
                sendMail: async () => {
                    throw new Error('SMTP recipient rejected')
                },
            },
        })
        const {app, home} = await createContext({mailer})

        const response = await request(app, {
            to:                     'f7a91c',
            firstName:              'Ada',
            lastName:               'Lovelace',
            email:                  'ada@example.com',
            consent:                true,
            renderedMessage:        'Confirmation {{confirm-url}}',
            supportRenderedMessage: 'Notification',
        })

        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({
            success: false,
            stored:  false,
            error:   'Launch registration confirmation email delivery is temporarily unavailable',
        })
        const pending = await readRegistrationFile(path.join(home, 'data', 'launch-registrations-pending.json'))
        expect(pending.registrations).toHaveLength(0)
        await expect(readFile(path.join(home, 'data', 'launch-registrations.json'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'})
    })

    test('confirms a pending registration, moves it to the confirmed file, and masks the email', async () => {
        const messages = []
        const mailer = new ContactMailService({
            sitePublicUrl: 'https://site.test',
            env: {
                LGS1920_CONTACT_TARGET_F7A91C: 'studio@lgs1920.fr',
            },
            transporter: {
                sendMail: async (message) => messages.push(message),
            },
        })
        const {app, home} = await createContext({mailer})

        await request(app, {
            to:                     'f7a91c',
            locale:                 'fr',
            firstName:              'Ada',
            lastName:               'Lovelace',
            email:                  'ada@example.com',
            consent:                true,
            supportRenderedMessage: 'Nouvelle inscription confirmée pour Studio.',
        })
        const confirmationUrl = extractConfirmationUrl(messages[0])
        const detailsResponse = await confirmDetailsRequest(app, {
            id:    confirmationUrl.searchParams.get('id'),
            token: confirmationUrl.searchParams.get('token'),
        })
        expect(detailsResponse.status).toBe(200)
        expect(await detailsResponse.json()).toMatchObject({
            success:   true,
            status:    'pending',
            form:      'launch-registration',
            locale:    'fr',
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
        })
        const response = await confirmRequest(app, {
            id:    confirmationUrl.searchParams.get('id'),
            token: confirmationUrl.searchParams.get('token'),
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(await response.json()).toEqual({
            success: true,
            status:  'confirmed',
            email:   'a*a@e*****e.com',
            message: 'Votre inscription est confirmée. Merci !',
            sent:    true,
        })
        expect(messages).toHaveLength(3)
        expect(messages[1].text).toContain('Inscription confirmée.')
        expect(messages[1].text).not.toContain('Nouvelle inscription confirmée pour Studio.')
        expect(messages[2].subject).toBe('[LGS1920] Confirmation de votre inscription')
        expect(messages[2].text).toContain('Votre inscription est confirmée')
        const cancellationLinkIndex = messages[2].text.indexOf('https://site.test/fr/registration/revoke/?')
        const signatureIndex = messages[2].text.indexOf('Cordialement')
        expect(cancellationLinkIndex).toBeGreaterThan(-1)
        expect(cancellationLinkIndex).toBeLessThan(signatureIndex)

        const pending = await readRegistrationFile(path.join(home, 'data', 'launch-registrations-pending.json'))
        const confirmed = await readRegistrationFile(path.join(home, 'data', 'launch-registrations.json'))
        expect(pending.registrations).toHaveLength(0)
        expect(confirmed.schemaVersion).toBe(3)
        expect(confirmed.registrations).toHaveLength(1)
        expect(confirmed.registrations[0]).toMatchObject({
            firstName:   'Ada',
            lastName:    'Lovelace',
            email:       'ada@example.com',
            confirmedAt: '2026-08-05T12:00:00.000Z',
        })
        expect(confirmed.registrations[0].confirmationTokenHash).toBeUndefined()
        expect(confirmed.registrations[0].cancellationTokenHash).toMatch(/^[a-f0-9]{64}$/u)
        expect(confirmed.registrations[0].renderedMessage).toBeUndefined()
        expect(confirmed.registrations[0].supportRenderedMessage).toBeUndefined()

        const repeatedResponse = await confirmRequest(app, {
            id:    confirmationUrl.searchParams.get('id'),
            token: confirmationUrl.searchParams.get('token'),
        })
        expect(repeatedResponse.status).toBe(404)
    })

    test('resends a rotated confirmation token for an existing pending email', async () => {
        let now = new Date(initialDate)
        const messages = []
        const mailer = new ContactMailService({
            sitePublicUrl: 'https://site.test',
            env: {
                LGS1920_CONTACT_TARGET_F7A91C: 'studio@lgs1920.fr',
            },
            transporter: {
                sendMail: async (message) => messages.push(message),
            },
        })
        const {app} = await createContext({mailer, clock: () => new Date(now)})

        const first = await request(app, {
            to:        'f7a91c',
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   true,
        })
        expect(first.status).toBe(200)
        const firstUrl = extractConfirmationUrl(messages[0])

        const duplicate = await request(app, {
            to:        'f7a91c',
            firstName: 'Augusta',
            lastName:  'King',
            email:     ' ADA@example.com ',
            consent:   true,
        })
        expect(duplicate.status).toBe(409)
        expect(await duplicate.json()).toEqual({
            success:   false,
            status:    'pending',
            canResend: true,
            error:     'Confirmation already pending',
            message:   'A confirmation email is already pending.',
        })

        now = new Date('2026-08-05T12:01:01.000Z')
        const resend = await resendRequest(app, {email: 'ADA@example.com'})
        expect(resend.status).toBe(200)
        expect(await resend.json()).toEqual({
            success: true,
            status:  'pending',
            resent:  true,
            message: 'A new confirmation email has been sent.',
        })
        expect(messages).toHaveLength(2)
        expect(messages[1].text).toContain('Confirm your registration')
        const secondUrl = extractConfirmationUrl(messages[1])
        expect(secondUrl.searchParams.get('token')).not.toBe(firstUrl.searchParams.get('token'))

        const oldTokenResponse = await confirmRequest(app, {
            id:    firstUrl.searchParams.get('id'),
            token: firstUrl.searchParams.get('token'),
        })
        expect(oldTokenResponse.status).toBe(404)

        const newTokenResponse = await confirmRequest(app, {
            id:    secondUrl.searchParams.get('id'),
            token: secondUrl.searchParams.get('token'),
        })
        expect(newTokenResponse.status).toBe(200)
    })

    test('does not report a resend as sent when the mailer is unavailable', async () => {
        const {app, home} = await createContext()
        await request(app, {
            to:        'f7a91c',
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   true,
        })

        const before = await readRegistrationFile(path.join(home, 'data', 'launch-registrations-pending.json'))
        const response = await resendRequest(app, {email: 'ada@example.com'})

        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({
            success: false,
            error:   'Confirmation email delivery is temporarily unavailable',
        })
        const after = await readRegistrationFile(path.join(home, 'data', 'launch-registrations-pending.json'))
        expect(after.registrations[0].confirmationTokenHash).toBe(before.registrations[0].confirmationTokenHash)
    })

    test('rejects an expired confirmation token and allows a fresh pending request', async () => {
        let now = new Date(initialDate)
        const messages = []
        const mailer = new ContactMailService({
            sitePublicUrl: 'https://site.test',
            env: {
                LGS1920_CONTACT_TARGET_F7A91C: 'studio@lgs1920.fr',
            },
            transporter: {
                sendMail: async (message) => messages.push(message),
            },
        })
        const {app} = await createContext({mailer, clock: () => new Date(now)})

        await request(app, {
            to:        'f7a91c',
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   true,
        })
        const expiredUrl = extractConfirmationUrl(messages[0])
        now = new Date('2026-08-07T12:00:01.000Z')

        const expiredResponse = await confirmRequest(app, {
            id:    expiredUrl.searchParams.get('id'),
            token: expiredUrl.searchParams.get('token'),
        })
        expect(expiredResponse.status).toBe(404)

        const freshResponse = await request(app, {
            to:        'f7a91c',
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   true,
        })
        expect(freshResponse.status).toBe(200)
        expect(messages).toHaveLength(2)
    })

    test('rejects a resend during the per-email cooldown', async () => {
        const messages = []
        const mailer = new ContactMailService({
            sitePublicUrl: 'https://site.test',
            env: {
                LGS1920_CONTACT_TARGET_F7A91C: 'studio@lgs1920.fr',
            },
            transporter: {
                sendMail: async (message) => messages.push(message),
            },
        })
        const {app} = await createContext({mailer})

        await request(app, {
            to:        'f7a91c',
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   true,
        })
        const response = await resendRequest(app, {email: 'ada@example.com'})

        expect(response.status).toBe(429)
        expect(response.headers.get('Retry-After')).toBe('60')
        expect(await response.json()).toEqual({success: false, error: 'Confirmation resend is temporarily unavailable'})
        expect(messages).toHaveLength(1)
    })

    test('revokes a confirmed registration only with its cancellation token', async () => {
        const messages = []
        const mailer = new ContactMailService({
            sitePublicUrl: 'https://site.test',
            env: {
                LGS1920_CONTACT_TARGET_F7A91C: 'studio@lgs1920.fr',
            },
            transporter: {
                sendMail: async (message) => messages.push(message),
            },
        })
        const {app, home} = await createContext({mailer})

        await request(app, {
            to:        'f7a91c',
            locale:    'fr',
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   true,
        })
        const confirmationUrl = extractConfirmationUrl(messages[0])
        await confirmRequest(app, {
            id:    confirmationUrl.searchParams.get('id'),
            token: confirmationUrl.searchParams.get('token'),
        })

        const cancellationLink = messages[2].text.match(/https:\/\/site\.test\/fr\/registration\/revoke\/\?[^\s)]+/u)?.[0]
        expect(cancellationLink).toBeString()
        const revokeResponse = await app.handle(new Request(`http://registration.test/launch-registration/revoke${new URL(cancellationLink).search}`))
        expect(revokeResponse.status).toBe(200)
        expect(await revokeResponse.json()).toEqual({
            success: true,
            email:   'a*a@e*****e.com',
            message: 'Votre inscription au lancement de LGS1920 Studio a été annulée.',
        })

        const repeatedResponse = await app.handle(new Request(`http://registration.test/launch-registration/revoke${new URL(cancellationLink).search}`))
        expect(repeatedResponse.status).toBe(404)
        const confirmed = await readRegistrationFile(path.join(home, 'data', 'launch-registrations.json'))
        expect(confirmed.registrations).toHaveLength(0)
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
        await expect(readFile(path.join(home, 'data', 'launch-registrations-pending.json'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'})
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

    test('reports confirmed duplicates after a pending email has been confirmed', async () => {
        const messages = []
        const mailer = new ContactMailService({
            sitePublicUrl: 'https://site.test',
            env: {
                LGS1920_CONTACT_TARGET_F7A91C: 'studio@lgs1920.fr',
            },
            transporter: {
                sendMail: async (message) => messages.push(message),
            },
        })
        const {app} = await createContext({mailer})

        await request(app, {
            to:        'f7a91c',
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   true,
        })
        const confirmationUrl = extractConfirmationUrl(messages[0])
        await confirmRequest(app, {
            id:    confirmationUrl.searchParams.get('id'),
            token: confirmationUrl.searchParams.get('token'),
        })

        const duplicate = await request(app, {
            to:        'f7a91c',
            firstName: 'Augusta',
            lastName:  'King',
            email:     ' ADA@EXAMPLE.COM ',
            consent:   true,
        })
        expect(duplicate.status).toBe(409)
        expect(await duplicate.json()).toEqual({success: false, error: 'Already registered'})
    })

    test('reports pending duplicates before checking unavailable mail configuration', async () => {
        const {app, store} = await createContext()
        await store.register({
            form:      'launch-registration',
            locale:    'en',
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   true,
        })

        const mailer = new ContactMailService({env: {}})
        const duplicateApp = new Elysia()
        new LaunchRegistrationResource(duplicateApp, {
            allowedOrigins: [allowedOrigin],
            mailer,
            store,
            rateLimiter: new ContactRateLimiter({getClientKey: () => 'test-client'}),
        })
        const duplicate = await request(duplicateApp, {
            to:        'f7a91c',
            firstName: 'Augusta',
            lastName:  'King',
            email:     'ADA@example.com',
            consent:   true,
        })

        expect(duplicate.status).toBe(409)
        expect(await duplicate.json()).toMatchObject({success: false, status: 'pending', canResend: true})
    })

    test('reloads pending registrations after the data file is cleared externally', async () => {
        const {app, home} = await createContext()
        const payload = {
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   true,
        }

        expect((await request(app, payload)).status).toBe(200)
        await writeFile(
            path.join(home, 'data', 'launch-registrations-pending.json'),
            JSON.stringify({schemaVersion: 3, registrations: []}),
            'utf8',
        )

        const reRegistration = await request(app, payload)
        expect(reRegistration.status).toBe(200)
        expect(await reRegistration.json()).toMatchObject({success: true, stored: true, status: 'pending'})
    })

    test('reloads pending registrations after one address is removed externally', async () => {
        const {app, home} = await createContext()
        const removedPayload = {
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   true,
        }
        const remainingPayload = {
            firstName: 'Grace',
            lastName:  'Hopper',
            email:     'grace@example.com',
            consent:   true,
        }

        expect((await request(app, removedPayload)).status).toBe(200)
        expect((await request(app, remainingPayload)).status).toBe(200)
        const pendingPath = path.join(home, 'data', 'launch-registrations-pending.json')
        const persisted = await readRegistrationFile(pendingPath)
        await writeFile(pendingPath, JSON.stringify({
            schemaVersion: 3,
            registrations: persisted.registrations.filter(({email}) => email !== removedPayload.email),
        }), 'utf8')

        const reRegistration = await request(app, removedPayload)
        expect(reRegistration.status).toBe(200)
        expect(await reRegistration.json()).toMatchObject({success: true, stored: true, status: 'pending'})
    })

    test('resets the local registration limit after an external pending clear', async () => {
        const {app, home} = await createContext({registrationLimit: 1})
        const payload = {
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            consent:   true,
        }

        expect((await request(app, payload)).status).toBe(200)
        await writeFile(
            path.join(home, 'data', 'launch-registrations-pending.json'),
            JSON.stringify({schemaVersion: 3, registrations: []}),
            'utf8',
        )

        const reRegistration = await request(app, payload)
        expect(reRegistration.status).toBe(200)
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
        expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/u)
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
        await expect(readFile(path.join(home, 'data', 'launch-registrations-pending.json'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'})
        await expect(readFile(path.join(home, 'data', 'launch-registrations.json'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'})
    })

    test('serializes concurrent registrations in the pending file', async () => {
        const {app, home} = await createContext()

        await Promise.all(Array.from({length: 40}, (_, index) => request(app, {
            firstName: `First${index}`,
            lastName:  'Test',
            email:     `person${index}@example.com`,
            consent:   true,
        })))

        const pending = await readRegistrationFile(path.join(home, 'data', 'launch-registrations-pending.json'))
        expect(pending.registrations).toHaveLength(40)
    })
})
