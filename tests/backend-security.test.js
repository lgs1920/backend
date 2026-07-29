import { afterEach, describe, expect, test } from 'bun:test'
import {
    createInternalApiGuard,
    createSecurityHeadersHook,
    getAllowedOrigins,
} from '../src/utils/BackendSecurity.js'
import { resolveSafeChildPath } from '../src/utils/PathSecurity.js'

const originalEnvironment = {...process.env}

/**
 * Restore environment variables changed by a security test.
 *
 * @returns {void}
 */
const restoreEnvironment = () => {
    for (const key of Object.keys(process.env)) {
        if (!(key in originalEnvironment)) {
            delete process.env[key]
        }
    }
    Object.assign(process.env, originalEnvironment)
}

afterEach(restoreEnvironment)

describe('backend security', () => {
    test('uses exact environment-specific CORS origins', () => {
        expect(getAllowedOrigins('production')).toEqual([
            'https://studio.lgs1920.fr',
            'https://lgs1920.fr',
        ])
        process.env.LGS1920_ALLOWED_ORIGINS = 'https://studio.example.test, https://site.example.test'
        expect(getAllowedOrigins('production')).toEqual([
            'https://studio.example.test',
            'https://site.example.test',
        ])
        process.env.LGS1920_ALLOWED_ORIGINS = 'http://insecure.example.test,*,https://valid.example.test/path'
        expect(getAllowedOrigins('production')).toEqual([])
    })

    test('fails closed for internal routes outside development', () => {
        process.env.NODE_ENV = 'production'
        delete process.env.LGS1920_INTERNAL_API_TOKEN
        const set = {status: 200, headers: {}}

        expect(createInternalApiGuard()({request: new Request('https://api.example.test'), set})).toEqual({
            success: false,
            error:   'Internal API access is not configured',
        })
        expect(set.status).toBe(503)
    })

    test('accepts only the configured bearer token', () => {
        process.env.LGS1920_INTERNAL_API_TOKEN = 'test-internal-token'
        const guard = createInternalApiGuard()
        const invalidSet = {status: 200, headers: {}}
        const validSet = {status: 200, headers: {}}

        expect(guard({request: new Request('https://api.example.test'), set: invalidSet})).toEqual({
            success: false,
            error:   'Internal API authentication required',
        })
        expect(invalidSet.status).toBe(401)
        expect(invalidSet.headers['WWW-Authenticate']).toBe('Bearer')
        expect(guard({
            request: new Request('https://api.example.test', {
                headers: {Authorization: 'Bearer test-internal-token'},
            }),
            set: validSet,
        })).toBeUndefined()
    })

    test('allows safe child paths and rejects traversal', () => {
        expect(resolveSafeChildPath('/srv/backend', 'data/count.json')).toBe('/srv/backend/data/count.json')
        expect(resolveSafeChildPath('/srv/backend', '../secrets.env')).toBeNull()
        expect(resolveSafeChildPath('/srv/backend', '/etc/passwd')).toBeNull()
        expect(resolveSafeChildPath('/srv/backend', 'data\0/count.json')).toBeNull()
    })

    test('adds security response headers and optional HSTS', () => {
        const set = {headers: {}}
        createSecurityHeadersHook({publicHttps: true})({set})

        expect(set.headers).toEqual({
            'X-Content-Type-Options':  'nosniff',
            'X-Frame-Options':          'DENY',
            'Referrer-Policy':          'strict-origin-when-cross-origin',
            'Permissions-Policy':       'camera=(), microphone=(), geolocation=()',
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        })
    })
})
