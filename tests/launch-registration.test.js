import { Elysia } from 'elysia'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LaunchRegistrationResource } from '../src/resources/LaunchRegistrationResource.js'
import { LaunchRegistrationStore } from '../src/services/LaunchRegistrationStore.js'

const homes = []

/**
 * Create an isolated launch registration application backed by a temporary directory.
 *
 * @returns {Promise<{app: Elysia, store: LaunchRegistrationStore, home: string}>} Test context.
 */
const createContext = async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'lgs1920-launch-registration-'))
    homes.push(home)
    const store = new LaunchRegistrationStore({
        backendHome: home,
        clock:      () => new Date('2026-08-05T12:00:00.000Z'),
    })
    await store.ready

    const app = new Elysia()
    new LaunchRegistrationResource(app, {store})

    return {app, store, home}
}

/**
 * Send a JSON request to an in-memory Elysia application.
 *
 * @param {Elysia} app Application under test.
 * @param {*} body JSON request body.
 * @returns {Promise<Response>} Application response.
 */
const request = (app, body) => app.handle(new Request('http://registration.test/launch-registration', {
    method:  'POST',
    headers: {'Content-Type': 'application/json'},
    body:    JSON.stringify(body),
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
