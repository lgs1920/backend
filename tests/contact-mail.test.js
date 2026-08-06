import {Elysia} from 'elysia'
import {describe, expect, test} from 'bun:test'
import {ContactMailResource} from '../src/resources/ContactMailResource.js'
import {ContactMailService} from '../src/services/ContactMailService.js'

const validPayload = {
    firstName: 'Ada',
    lastName:  'Lovelace',
    email:     'ada@example.com',
    subject:   'Studio question',
    message:   'I would like to know more about Studio.',
    consent:   true,
}

const request = (app, body) => app.handle(new Request('http://contact.test/contact', {
    method:  'POST',
    headers: {'Content-Type': 'application/json'},
    body:    JSON.stringify(body),
}))

describe('contact email API', () => {
    test('sends a valid contact message without returning personal data', async () => {
        const messages = []
        const mailer = new ContactMailService({
            env: {
                LGS1920_CONTACT_RECIPIENT: 'studio@lgs1920.fr',
                LGS1920_CONTACT_FROM:      'studio@lgs1920.fr',
            },
            transporter: {
                sendMail: async (message) => messages.push(message),
            },
        })
        const app = new Elysia()
        new ContactMailResource(app, {mailer})

        const response = await request(app, validPayload)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({success: true, sent: true})
        expect(messages).toHaveLength(1)
        expect(messages[0]).toMatchObject({
            from:    'studio@lgs1920.fr',
            to:      'studio@lgs1920.fr',
            replyTo: 'ada@example.com',
            subject: '[LGS1920 Contact] Studio question',
        })
        expect(messages[0].text).toContain('I would like to know more about Studio.')
    })

    test('rejects invalid contact payloads', async () => {
        const app = new Elysia()
        new ContactMailResource(app, {
            mailer: new ContactMailService({transporter: {sendMail: async () => undefined}}),
        })

        const response = await request(app, {...validPayload, consent: false})

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({success: false, error: 'Consent is required'})
    })

    test('does not send honeypot submissions', async () => {
        let sendCount = 0
        const app = new Elysia()
        new ContactMailResource(app, {
            mailer: new ContactMailService({
                transporter: {
                    sendMail: async () => {
                        sendCount += 1
                    },
                },
            }),
        })

        const response = await request(app, {...validPayload, website: 'https://spam.example'})

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({success: true, sent: false})
        expect(sendCount).toBe(0)
    })

    test('returns 503 when SMTP is not configured', async () => {
        const app = new Elysia()
        new ContactMailResource(app, {
            mailer: new ContactMailService({env: {}}),
        })

        const response = await request(app, validPayload)

        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({success: false, error: 'Contact email delivery is temporarily unavailable'})
    })
})
