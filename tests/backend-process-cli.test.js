import { describe, expect, test } from 'bun:test'
import {
    parseEnvironmentFile,
    resolveBackendProcessConfiguration,
} from '../scripts/backend-process-cli.js'

describe('backend process administration command', () => {
    test('parses quoted and unquoted environment assignments', () => {
        expect(parseEnvironmentFile("PORT=3333\nSECRET='value-with-&-symbols'\nexport FLAG=true\n")).toEqual({
            PORT:   '3333',
            SECRET: 'value-with-&-symbols',
            FLAG:   'true',
        })
    })

    test('resolves process paths for a deployed backend release', () => {
        expect(resolveBackendProcessConfiguration({
            cwd: '/home/www/lgs1920/production/backend/current',
            env: {LGS1920_PM2_BIN: '/usr/bin/pm2'},
        })).toEqual({
            app:              'backend-production',
            bin:              '/usr/bin/pm2',
            cwd:              '/home/www/lgs1920/production/backend/current',
            ecosystemPath:    '/home/www/lgs1920/production/backend/current/ecosystem.config.js',
            environmentPath: '/home/www/lgs1920/production/backend/shared/backend.env',
        })
    })

    test('does not resolve PM2 for a local development path', () => {
        expect(resolveBackendProcessConfiguration({
            cwd: '/home/christian/devs/assets/lgs1920/backend',
            env: {LGS1920_PM2_BIN: '/usr/bin/pm2'},
        })).toBeNull()
    })
})
