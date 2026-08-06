import {Elysia} from 'elysia'
import {describe, expect, test} from 'bun:test'
import {ContactMailResource} from '../src/resources/ContactMailResource.js'
import {ContactMailService} from '../src/services/ContactMailService.js'
import {ContactRateLimiter} from '../src/utils/ContactRateLimiter.js'

const validPayload = {
    to:        'f7a91c',
    firstName: 'Ada',
    lastName:  'Lovelace',
    email:     'ada@example.com',
    subject:   'Studio question',
    message:   'I would like to know more about Studio.',
    consent:   true,
}

const allowedOrigin = 'https://studio.test'
const csrfSecret = 'contact-test-secret-with-at-least-32-bytes'

const requestToken = async (app, origin = allowedOrigin) => {
    const response = await app.handle(new Request('http://contact.test/contact/token', {
        headers: {Origin: origin},
    }))
    const payload = await response.json()
    return payload.token
}

const request = async (app, body, {origin = allowedOrigin, csrfToken = undefined} = {}) => app.handle(new Request('http://contact.test/contact', {
    method:  'POST',
    headers: {
        'Content-Type': 'application/json',
        Origin:         origin,
    },
    body: JSON.stringify({
        ...body,
        csrfToken: csrfToken ?? await requestToken(app, origin),
    }),
}))

const createApp = (mailer, rateLimiter = new ContactRateLimiter({
    getClientKey: () => 'test-client',
})) => {
    const app = new Elysia()
    new ContactMailResource(app, {
        allowedOrigins: [allowedOrigin],
        csrfSecret,
        mailer,
        rateLimiter,
    })
    return app
}

describe('contact email API', () => {
    test('sends a valid contact message without returning personal data', async () => {
        const messages = []
        const mailer = new ContactMailService({
            env: {
                LGS1920_CONTACT_TARGET_F7A91C: 'studio@lgs1920.fr',
            },
            transporter: {
                sendMail: async (message) => messages.push(message),
            },
        })
        const app = createApp(mailer)

        const response = await request(app, validPayload)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({success: true, sent: true})
        expect(messages).toHaveLength(1)
        expect(messages[0]).toMatchObject({
            from:    {
                name:    'ada@example.com',
                address: 'studio@lgs1920.fr',
            },
            to:      'studio@lgs1920.fr',
            replyTo: 'ada@example.com',
            subject: '[LGS1920 Contact] Studio question',
        })
        expect(messages[0].text).toContain('I would like to know more about Studio.')
        expect(messages[0].text).not.toContain('New message from the LGS1920 contact form')
    })

    test('rejects invalid contact payloads', async () => {
        const app = createApp(new ContactMailService({transporter: {sendMail: async () => undefined}}))

        const response = await request(app, {...validPayload, consent: false})

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({success: false, error: 'Consent is required'})
    })

    test('does not send honeypot submissions', async () => {
        let sendCount = 0
        const app = createApp(new ContactMailService({
            env: {
                LGS1920_CONTACT_TARGET_F7A91C: 'studio@lgs1920.fr',
            },
            transporter: {
                sendMail: async () => {
                    sendCount += 1
                },
            },
        }))

        const response = await request(app, {...validPayload, website: 'https://spam.example'})

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({success: true, sent: false})
        expect(sendCount).toBe(0)
    })

    test('returns 503 when SMTP is not configured', async () => {
        const app = createApp(new ContactMailService({env: {}}))

        const response = await request(app, validPayload)

        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({success: false, error: 'Contact email delivery is temporarily unavailable'})
    })

    test('rejects a contact request from an unlisted origin', async () => {
        const app = createApp(new ContactMailService({env: {}}))

        const response = await app.handle(new Request('http://contact.test/contact/token', {
            headers: {Origin: 'https://untrusted.test'},
        }))

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({success: false, error: 'Contact request origin is not allowed'})
    })

    test('rejects a contact request with an invalid CSRF token', async () => {
        const app = createApp(new ContactMailService({env: {}}))

        const response = await request(app, validPayload, {csrfToken: 'invalid-token'})

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({success: false, error: 'Contact request token is invalid'})
    })

    test('rejects an unknown contact target without sending', async () => {
        let sendCount = 0
        const app = createApp(new ContactMailService({
            env: {
                LGS1920_CONTACT_TARGET_F7A91C: 'studio@lgs1920.fr',
            },
            transporter: {
                sendMail: async () => {
                    sendCount += 1
                },
            },
        }))

        const response = await request(app, {...validPayload, to: 'unknown'})

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({success: false, error: 'Invalid contact target'})
        expect(sendCount).toBe(0)
    })

    test('limits repeated contact sends and returns Retry-After', async () => {
        const messages = []
        const mailer = new ContactMailService({
            env: {
                LGS1920_CONTACT_TARGET_F7A91C: 'studio@lgs1920.fr',
            },
            transporter: {
                sendMail: async (message) => messages.push(message),
            },
        })
        const app = createApp(mailer, new ContactRateLimiter({
            windowMs:   60_000,
            tokenLimit: 10,
            sendLimit:  1,
            getClientKey: () => 'test-client',
        }))

        expect((await request(app, validPayload)).status).toBe(200)
        const response = await request(app, validPayload)

        expect(response.status).toBe(429)
        expect(response.headers.get('Retry-After')).toBe('60')
        expect(await response.json()).toEqual({success: false, error: 'Too many contact requests'})
        expect(messages).toHaveLength(1)
    })

    test('limits token issuance independently from message sends', async () => {
        const app = createApp(new ContactMailService({transporter: {sendMail: async () => undefined}}), new ContactRateLimiter({
            windowMs:   60_000,
            tokenLimit: 1,
            sendLimit:  5,
            getClientKey: () => 'test-client',
        }))

        const tokenResponse = await app.handle(new Request('http://contact.test/contact/token', {
            headers: {Origin: allowedOrigin},
        }))

        expect(tokenResponse.status).toBe(200)
        expect(tokenResponse.headers.get('Cache-Control')).toBe('no-store')

        const response = await app.handle(new Request('http://contact.test/contact/token', {
            headers: {Origin: allowedOrigin},
        }))

        expect(response.status).toBe(429)
        expect(response.headers.get('Retry-After')).toBe('60')
    })

    test('configures TLS and bounded SMTP timeouts', () => {
        const service = new ContactMailService({
            env: {
                LGS1920_SMTP_HOST:                      'smtp.example.org',
                LGS1920_SMTP_PORT:                      '587',
                LGS1920_SMTP_SECURE:                    'false',
                LGS1920_SMTP_USER:                      'relay@example.org',
                LGS1920_SMTP_PASSWORD:                  'test-password',
                LGS1920_SMTP_CONNECTION_TIMEOUT_MS:     '12000',
                LGS1920_SMTP_GREETING_TIMEOUT_MS:       '8000',
                LGS1920_SMTP_SOCKET_TIMEOUT_MS:         '25000',
                LGS1920_CONTACT_TARGET_F7A91C:         'studio@lgs1920.fr',
            },
        })

        const transport = service.createTransport()

        expect(transport.options).toMatchObject({
            port:              587,
            secure:            false,
            requireTLS:        true,
            connectionTimeout: 12000,
            greetingTimeout:   8000,
            socketTimeout:     25000,
            tls:               {rejectUnauthorized: true},
        })
    })

    test('uses the resolved contact target as the SMTP login', () => {
        const service = new ContactMailService({
            env: {
                LGS1920_SMTP_HOST:             'smtp.example.org',
                LGS1920_SMTP_PORT:             '465',
                LGS1920_SMTP_SECURE:           'true',
                LGS1920_SMTP_USER:             'legacy-relay@example.org',
                LGS1920_SMTP_PASSWORD:         'test-password',
                LGS1920_CONTACT_TARGET_F7A91C: 'studio@lgs1920.fr',
            },
        })

        const transport = service.createTransport('studio@lgs1920.fr')

        expect(transport.options.auth).toEqual({
            user: 'studio@lgs1920.fr',
            pass: 'test-password',
        })
    })

    test('rejects insecure implicit-TLS configuration', () => {
        const service = new ContactMailService({
            env: {
                LGS1920_SMTP_HOST:              'smtp.example.org',
                LGS1920_SMTP_PORT:              '465',
                LGS1920_SMTP_SECURE:            'false',
                LGS1920_CONTACT_TARGET_F7A91C:  'studio@lgs1920.fr',
            },
        })

        expect(() => service.createTransport()).toThrow('SMTP port 465 requires implicit TLS')
    })
})
