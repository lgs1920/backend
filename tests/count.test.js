import { Elysia } from 'elysia'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CountResource } from '../src/resources/CountResource.js'
import { CountStore, getPeriodKeys, getUtcPeriodKeys } from '../src/services/CountStore.js'

const stores = []
const homes = []

/**
 * Create an isolated count application using a deterministic UTC clock.
 *
 * @param {string} [initialDate] Initial clock value.
 * @returns {Promise<{app: Elysia, store: CountStore, home: string, setDate: (value: string) => void}>} Test context.
 */
const createContext = async (initialDate = '2026-07-29T12:00:00.000Z') => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'lgs1920-count-'))
    homes.push(home)
    let currentDate = new Date(initialDate)
    const store = new CountStore({
        backendHome: home,
        clock:      () => new Date(currentDate),
        autoPersist: false,
    })
    stores.push(store)
    await store.ready

    const app = new Elysia()
    new CountResource(app, {store})

    return {
        app,
        store,
        home,
        setDate: (value) => {
            currentDate = new Date(value)
        },
    }
}

/**
 * Send a request to an in-memory Elysia application.
 *
 * @param {Elysia} app Application under test.
 * @param {string} route Request path.
 * @param {string} [method='GET'] HTTP method.
 * @returns {Promise<Response>} Application response.
 */
const request = (app, route, method = 'GET', body = undefined) => app.handle(new Request(`http://count.test${route}`, {
    method,
    ...(body === undefined ? {} : {
        headers: {'Content-Type': 'application/json'},
        body:    JSON.stringify(body),
    }),
}))

afterEach(async () => {
    await Promise.all(stores.splice(0).map(store => store.close().catch(() => undefined)))
    await Promise.all(homes.splice(0).map(home => rm(home, {recursive: true, force: true})))
})

describe('count API', () => {
    test('uses ISO week-year boundaries in UTC', () => {
        expect(getUtcPeriodKeys('2021-01-01T00:00:00.000Z')).toEqual({
            daily:   '01-01-2021',
            weekly:  '2020-W53',
            monthly: '01-21',
            yearly:  '2021',
        })
    })

    test('resolves event periods in the client time zone', () => {
        const instant = '2026-07-29T22:30:00.000Z'

        expect(getPeriodKeys(instant, 'Europe/Paris').daily).toBe('30-07-2026')
        expect(getPeriodKeys(instant, 'America/Montreal').daily).toBe('29-07-2026')
        expect(getPeriodKeys(instant, 'America/Montreal').weekly).toBe('2026-W31')
    })

    test('counts every event in all UTC aggregate periods', async () => {
        const {app, store} = await createContext()

        for (const route of ['/count/visit', '/count/journey', '/count/journey', '/count/video/draft', '/count/video/hq']) {
            const response = await request(app, route, 'POST')
            expect(response.status).toBe(200)
        }

        const snapshot = await (await request(app, '/count')).json()
        expect(snapshot.total).toEqual({
            visits:  1,
            journeys: 2,
            videos:  {draft: 1, hq: 1},
        })
        expect(snapshot.daily['29-07-2026']).toEqual(snapshot.total)
        expect(snapshot.weekly['2026-W31']).toEqual(snapshot.total)
        expect(snapshot.monthly['07-26']).toEqual(snapshot.total)
        expect(snapshot.yearly['2026']).toEqual(snapshot.total)

        expect(await (await request(app, '/count/visits')).json()).toBe(1)
        expect(await (await request(app, '/count/journeys')).json()).toBe(2)
        expect(await (await request(app, '/count/videos')).json()).toEqual({draft: 1, hq: 1})
        expect(await (await request(app, '/count/visits/daily')).json()).toBe(1)
        expect(await (await request(app, '/count/daily')).json()).toEqual(snapshot.daily['29-07-2026'])
        expect(await (await request(app, '/count/daily/29-07-2026')).json()).toEqual(snapshot.daily['29-07-2026'])
        expect(await (await request(app, '/count/weekly/2026-W31')).json()).toEqual(snapshot.weekly['2026-W31'])
        expect(await (await request(app, '/count/monthly/07-26')).json()).toEqual(snapshot.monthly['07-26'])
        expect(await (await request(app, '/count/yearly/2026')).json()).toEqual(snapshot.yearly['2026'])

        expect((await store.getSnapshot()).total.journeys).toBe(2)
    })

    test('uses current UTC periods by default without creating rows during reads', async () => {
        const {app, store, setDate} = await createContext()
        await store.recordEvent('visit')
        await store.saveNow()
        const beforeRead = await readFile(store.filePath, 'utf8')

        setDate('2026-07-30T00:01:00.000Z')
        expect(await (await request(app, '/count/daily')).json()).toEqual({visits: 0, journeys: 0, videos: {draft: 0, hq: 0}})
        expect(await (await request(app, '/count/visits/daily')).json()).toBe(0)
        expect(await (await request(app, '/count/monthly')).json()).toEqual({visits: 1, journeys: 0, videos: {draft: 0, hq: 0}})
        expect(await (await request(app, '/count/daily/29-07-2026')).json()).toEqual({visits: 1, journeys: 0, videos: {draft: 0, hq: 0}})
        expect(await store.getSnapshot()).toEqual(JSON.parse(beforeRead))
        expect(await readFile(store.filePath, 'utf8')).toBe(beforeRead)
    })

    test('uses the client time zone for event and current-period reads', async () => {
        const {app, store} = await createContext('2026-07-29T22:30:00.000Z')

        const parisEvent = await request(app, '/count/visit', 'POST', {timeZone: 'Europe/Paris'})
        const montrealEvent = await request(app, '/count/visit', 'POST', {timeZone: 'America/Montreal'})

        expect(parisEvent.status).toBe(200)
        expect((await parisEvent.json()).timeZone).toBe('Europe/Paris')
        expect(montrealEvent.status).toBe(200)
        expect((await montrealEvent.json()).timeZone).toBe('America/Montreal')
        expect(await (await request(app, '/count/daily?timeZone=Europe%2FParis')).json()).toEqual({
            visits:  1,
            journeys: 0,
            videos:  {draft: 0, hq: 0},
        })
        expect(await (await request(app, '/count/daily?timeZone=America%2FMontreal')).json()).toEqual({
            visits:  1,
            journeys: 0,
            videos:  {draft: 0, hq: 0},
        })
        expect((await store.getSnapshot()).total.visits).toBe(2)
    })

    test('persists the total and previous-day history before a restart', async () => {
        const {store, home} = await createContext('2026-07-29T12:00:00.000Z')
        await store.recordEvent('visit', null, 'America/Montreal')

        const reloaded = new CountStore({
            backendHome: home,
            clock:      () => new Date('2026-07-30T12:00:00.000Z'),
            autoPersist: false,
        })
        stores.push(reloaded)
        await reloaded.ready

        expect((await reloaded.getSnapshot()).total.visits).toBe(1)
        expect((await reloaded.getPeriod('daily', '29-07-2026')).visits).toBe(1)
    })

    test('recovers from a corrupted file and initializes valid storage', async () => {
        const home = await mkdtemp(path.join(os.tmpdir(), 'lgs1920-count-corrupt-'))
        homes.push(home)
        const dataDirectory = path.join(home, 'data')
        await mkdir(dataDirectory, {recursive: true})
        await writeFile(path.join(dataDirectory, 'count.json'), '{not-json', 'utf8')

        const store = new CountStore({backendHome: home, autoPersist: false})
        stores.push(store)
        await store.ready

        expect((await store.getSnapshot()).total).toEqual({
            visits:  0,
            journeys: 0,
            videos:  {draft: 0, hq: 0},
        })
        const recovered = JSON.parse(await readFile(store.filePath, 'utf8'))
        expect(recovered.schemaVersion).toBe(1)
        expect(recovered).not.toHaveProperty('events')
    })

    test('persists atomically and reloads aggregate data', async () => {
        const {store, home} = await createContext()
        await Promise.all([store.recordEvent('visit'), store.recordEvent('video/hq')])
        await store.saveNow()

        const persisted = JSON.parse(await readFile(store.filePath, 'utf8'))
        expect(persisted.total).toEqual({
            visits:  1,
            journeys: 0,
            videos:  {draft: 0, hq: 1},
        })

        const reloaded = new CountStore({
            backendHome: home,
            autoPersist: false,
        })
        stores.push(reloaded)
        await reloaded.ready
        expect((await reloaded.getSnapshot()).total).toEqual(persisted.total)
    })

    test('serializes concurrent event mutations through one FIFO queue', async () => {
        const {store} = await createContext()
        await Promise.all(Array.from({length: 200}, () => store.recordEvent('journey')))

        const snapshot = await store.getSnapshot()
        expect(snapshot.total.journeys).toBe(200)
        expect(snapshot.daily['29-07-2026'].journeys).toBe(200)
        expect(JSON.stringify(snapshot)).not.toContain('127.0.0.1')
    })

    test('rejects invalid read parameters with a controlled error', async () => {
        const {app} = await createContext()

        const invalidItem = await request(app, '/count/unknown')
        expect(invalidItem.status).toBe(400)
        expect(await invalidItem.json()).toEqual({success: false, error: 'Unsupported count item'})

        const invalidDate = await request(app, '/count/daily/31-02-2026')
        expect(invalidDate.status).toBe(400)
        expect(await invalidDate.json()).toEqual({success: false, error: 'Invalid count period key'})

        const invalidTimeZone = await request(app, '/count/daily?timeZone=Not%2FA%20TimeZone')
        expect(invalidTimeZone.status).toBe(400)
        expect(await invalidTimeZone.json()).toEqual({success: false, error: 'Invalid count time zone'})

        const invalidEvent = await request(app, '/count/visit', 'POST', {timeZone: 'Not/A TimeZone'})
        expect(invalidEvent.status).toBe(400)
        expect(await invalidEvent.json()).toEqual({success: false, error: 'Invalid count time zone'})
    })
})
