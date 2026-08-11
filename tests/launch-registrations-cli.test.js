import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
    clearRegistrations,
    clearByScope,
    formatPendingRegistrationRows,
    formatRegistrationRows,
    parseArguments,
    readConfiguredRegistrationFile,
    readRegistrationFile,
    removeRegistrations,
    resolvePendingRegistrationFile,
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
        expect(parseArguments(['--list'])).toEqual({action: 'list', email: null, confirmed: false, scope: 'confirmed'})
        expect(parseArguments(['--list', '--pending'])).toEqual({action: 'list', email: null, confirmed: false, scope: 'pending'})
        expect(parseArguments(['--list', '--confirmed'])).toEqual({action: 'list', email: null, confirmed: false, scope: 'confirmed'})
        expect(parseArguments(['--remove', 'ADA@example.com', '--yes'])).toEqual({action: 'remove', email: 'ada@example.com', confirmed: true, scope: null})
        expect(parseArguments(['clear'])).toEqual({action: 'clear', email: null, confirmed: false, scope: 'confirmed'})
        expect(parseArguments(['clear', '--confirmed'])).toEqual({action: 'clear', email: null, confirmed: false, scope: 'confirmed'})
        expect(parseArguments(['clear', '--pending'])).toEqual({action: 'clear', email: null, confirmed: false, scope: 'pending'})
        expect(parseArguments(['--clear', '--all', '--yes'])).toEqual({action: 'clear', email: null, confirmed: true, scope: 'all'})
    })

    test('accepts data scope options only with list or clear actions', () => {
        expect(() => parseArguments(['--pending', '--remove', 'ada@example.com'])).toThrow('--confirmed, --pending, and --all can only be used with clear or list')
        expect(() => parseArguments(['--list', '--all'])).toThrow('--all can only be used with clear')
        expect(() => parseArguments(['clear', '--pending', '--all'])).toThrow('Choose only one scope')
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

    test('formats pending list rows with expiry without private token hashes', () => {
        const rows = formatPendingRegistrationRows([{
            ...registration('ada@example.com'),
            confirmationSentAt: '2026-08-10T12:01:00.000Z',
            expiresAt:          '2026-08-12T12:01:00.000Z',
        }])
        expect(rows).toEqual([{
            firstName:          'Ada',
            lastName:           'Lovelace',
            email:              'ada@example.com',
            createdAt:          '2026-08-10T12:00:00.000Z',
            confirmationSentAt: '2026-08-10T12:01:00.000Z',
            expiresAt:          '2026-08-12T12:01:00.000Z',
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
            expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({schemaVersion: 3, registrations: []})
        }
        finally {
            await rm(home, {recursive: true, force: true})
        }
    })

    test('resolves and clears confirmed and pending registrations together', async () => {
        const {home, filePath} = await createDataFile([registration('ada@example.com')])
        const pendingFilePath = resolvePendingRegistrationFile(filePath)
        await writeFile(pendingFilePath, JSON.stringify({
            schemaVersion: 3,
            registrations: [registration('grace@example.com', 'Grace')],
        }), 'utf8')

        try {
            expect(await clearByScope('all', filePath, pendingFilePath)).toEqual({confirmed: 1, pending: 1})
            expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({schemaVersion: 3, registrations: []})
            expect(JSON.parse(await readFile(pendingFilePath, 'utf8'))).toEqual({schemaVersion: 3, registrations: []})
        }
        finally {
            await rm(home, {recursive: true, force: true})
        }
    })

    test('clears only the pending registrations when requested', async () => {
        const {home, filePath} = await createDataFile([registration('ada@example.com')])
        const pendingFilePath = resolvePendingRegistrationFile(filePath)
        await writeFile(pendingFilePath, JSON.stringify({
            schemaVersion: 3,
            registrations: [registration('grace@example.com', 'Grace')],
        }), 'utf8')

        try {
            expect(await clearByScope('pending', filePath, pendingFilePath)).toEqual({confirmed: 0, pending: 1})
            expect(JSON.parse(await readFile(filePath, 'utf8')).registrations).toHaveLength(1)
            expect(JSON.parse(await readFile(pendingFilePath, 'utf8')).registrations).toHaveLength(0)
        }
        finally {
            await rm(home, {recursive: true, force: true})
        }
    })

    test('clears only confirmed registrations by default', async () => {
        const {home, filePath} = await createDataFile([registration('ada@example.com')])
        const pendingFilePath = resolvePendingRegistrationFile(filePath)
        await writeFile(pendingFilePath, JSON.stringify({
            schemaVersion: 3,
            registrations: [registration('grace@example.com', 'Grace')],
        }), 'utf8')

        try {
            expect(await clearByScope('confirmed', filePath, pendingFilePath)).toEqual({confirmed: 1, pending: 0})
            expect(JSON.parse(await readFile(filePath, 'utf8')).registrations).toHaveLength(0)
            expect(JSON.parse(await readFile(pendingFilePath, 'utf8')).registrations).toHaveLength(1)
        }
        finally {
            await rm(home, {recursive: true, force: true})
        }
    })
})
