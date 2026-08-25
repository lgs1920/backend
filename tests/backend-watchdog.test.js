import {afterEach, describe, expect, test} from 'bun:test'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {
    probeBackend,
    runWatchdogCycle,
    shouldRestartBackend,
} from '../scripts/backend-watchdog.js'
import {parseEnvironmentFile} from '../scripts/backend-startup.js'

const temporaryDirectories = []

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {recursive: true, force: true})))
})

const createTemporaryState = async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lgs1920-watchdog-'))
    temporaryDirectories.push(directory)
    const environmentFile = path.join(directory, 'backend.env')
    const statePath = path.join(directory, 'watchdog-state.json')
    await writeFile(environmentFile, 'LGS1920_WATCHDOG_ALERT_TO=\n', {mode: 0o600})
    return {environmentFile, statePath}
}

describe('backend startup environment parsing', () => {
    test('parses comments and quoted values without evaluating shell code', () => {
        expect(parseEnvironmentFile('# comment\nPORT=3333\nMESSAGE="hello world"\n')).toEqual({
            PORT:    '3333',
            MESSAGE: 'hello world',
        })
    })
})

describe('backend liveness probe', () => {
    test('accepts a healthy liveness response', async () => {
        const result = await probeBackend({
            url:       'http://127.0.0.1/ping',
            fetchImpl: async () => new Response(JSON.stringify({alive: true}), {status: 200}),
        })

        expect(result).toEqual({ok: true})
    })

    test('rejects a response without the liveness flag', async () => {
        const result = await probeBackend({
            url:       'http://127.0.0.1/ping',
            fetchImpl: async () => new Response(JSON.stringify({alive: false}), {status: 200}),
        })

        expect(result).toEqual({ok: false, reason: 'Invalid liveness response'})
    })
})

describe('backend watchdog cycle', () => {
    test('waits for consecutive failures before restarting', async () => {
        const {environmentFile, statePath} = await createTemporaryState()
        const restarts = []
        const alerts = []
        const options = {
            platform:        'test',
            url:             'http://127.0.0.1:3335/ping',
            pm2Bin:          '/home/.bun/bin/pm2',
            pm2App:          'backend-test',
            environmentFile,
            statePath,
            now:             1_000,
            probe:           async () => ({ok: false, reason: 'Request timeout'}),
            restart:         async details => restarts.push(details),
            alert:           async details => alerts.push(details),
        }

        await expect(runWatchdogCycle(options)).resolves.toEqual({status: 'unhealthy', restarted: false})
        await expect(runWatchdogCycle(options)).resolves.toEqual({status: 'restarted', restarted: true})

        expect(restarts).toHaveLength(1)
        expect(restarts[0].pm2App).toBe('backend-test')
        expect(alerts).toHaveLength(1)
        expect(alerts[0].status).toBe('restarted')
        expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({
            consecutiveFailures: 0,
            lastRestartAt:        1_000,
            outageActive:         true,
        })
    })

    test('honors the restart cooldown', () => {
        expect(shouldRestartBackend({consecutiveFailures: 2, lastRestartAt: 1_000}, 1_000 + 29 * 60 * 1_000)).toBe(false)
        expect(shouldRestartBackend({consecutiveFailures: 2, lastRestartAt: 1_000}, 1_000 + 30 * 60 * 1_000)).toBe(true)
    })

    test('throttles repeated restart failures', async () => {
        const {environmentFile, statePath} = await createTemporaryState()
        const restarts = []
        const options = {
            platform:        'test',
            url:             'http://127.0.0.1:3335/ping',
            pm2Bin:          '/home/.bun/bin/pm2',
            pm2App:          'backend-test',
            environmentFile,
            statePath,
            now:             2_000,
            probe:           async () => ({ok: false, reason: 'Request failed'}),
            restart:         async () => {
                restarts.push(true)
                throw new Error('PM2 unavailable')
            },
            alert:           async () => undefined,
        }

        await runWatchdogCycle(options)
        await runWatchdogCycle(options)
        await runWatchdogCycle(options)

        expect(restarts).toHaveLength(1)
    })
})
