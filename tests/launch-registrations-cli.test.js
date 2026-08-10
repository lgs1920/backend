import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
    clearRegistrations,
    formatRegistrationRows,
    parseArguments,
    readConfiguredRegistrationFile,
    readRegistrationFile,
    removeRegistrations,
    resolvePm2Configuration,
} from '../scripts/launch-registrations-cli.js'

const createDataFile = async registrations => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'lgs1920-registration-cli-'))
    const filePath = path.join(home, 'data', 'launch-registrations.json')
    await mkdir(path.dirname(filePath), {recursive: true})
    await writeFile(filePath, JSON.stringify({schemaVersion: 2, registrations}), 'utf8')
    return {home, filePath}
}

const registration = (email, firstName = 'Ada') => ({
    id:                 `${email}-id`,
    createdAt:          '2026-08-10T12:00:00.000Z',
    cancellationTokenHash: 'private-token-hash',
    firstName,
    lastName:            'Lovelace',
    email,
})

describe('launch registration administration command', () => {
    test('parses list, remove, clear, and confirmation options', () => {
        expect(parseArguments(['--list'])).toEqual({action: 'list', email: null, confirmed: false})
        expect(parseArguments(['--remove', 'ADA@example.com', '--yes'])).toEqual({action: 'remove', email: 'ada@example.com', confirmed: true})
        expect(parseArguments(['clear'])).toEqual({action: 'clear', email: null, confirmed: false})
    })

    test('detects PM2 only for deployed backend paths', () => {
        expect(resolvePm2Configuration({
            cwd: '/home/www/lgs1920/production/backend/current',
            env: {},
        })).toBeNull()
        expect(resolvePm2Configuration({
            cwd: '/home/www/lgs1920/production/backend/current',
            env: {LGS1920_PM2_BIN: '/usr/bin/pm2'},
        })).toEqual({app: 'backend-production', bin: '/usr/bin/pm2'})
        expect(resolvePm2Configuration({
            cwd: '/home/christian/devs/assets/lgs1920/backend',
            env: {LGS1920_PM2_BIN: '/usr/bin/pm2'},
        })).toBeNull()
    })

    test('formats list rows without private cancellation hashes', () => {
        const rows = formatRegistrationRows([registration('ada@example.com')])
        expect(rows).toEqual([{
            firstName: 'Ada',
            lastName:  'Lovelace',
            email:     'ada@example.com',
            createdAt: '2026-08-10T12:00:00.000Z',
        }])
        expect(JSON.stringify(rows)).not.toContain('private-token-hash')
    })

    test('reads the persistent registration path from generated server configuration', async () => {
        const home = await mkdtemp(path.join(os.tmpdir(), 'lgs1920-registration-config-'))
        const configurationPath = path.join(home, 'servers.json')
        try {
            await writeFile(configurationPath, JSON.stringify({
                backend: {
                    registrationFile: '/home/www/lgs1920/production/backend/shared/launch-registrations.json',
                },
            }), 'utf8')
            expect(readConfiguredRegistrationFile(configurationPath))
                .toBe('/home/www/lgs1920/production/backend/shared/launch-registrations.json')
        }
        finally {
            await rm(home, {recursive: true, force: true})
        }
    })

    test('removes registrations by normalized email and preserves other records', async () => {
        const {home, filePath} = await createDataFile([
            registration('ada@example.com'),
            registration('grace@example.com', 'Grace'),
        ])
        try {
            expect(await removeRegistrations(filePath, ' ADA@EXAMPLE.COM ')).toEqual({removed: 1, remaining: 1})
            const persisted = await readRegistrationFile(filePath)
            expect(persisted.registrations.map(item => item.email)).toEqual(['grace@example.com'])
        }
        finally {
            await rm(home, {recursive: true, force: true})
        }
    })

    test('clears all registrations atomically', async () => {
        const {home, filePath} = await createDataFile([registration('ada@example.com')])
        try {
            expect(await clearRegistrations(filePath)).toEqual({removed: 1})
            expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({schemaVersion: 2, registrations: []})
        }
        finally {
            await rm(home, {recursive: true, force: true})
        }
    })
})
