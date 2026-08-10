import {describe, expect, test} from 'bun:test'
import {resolveSitePublicUrl} from '../src/utils/SitePublicUrl.js'

const productionConfiguration = {
    site: {
        domain:   'lgs1920.fr',
        protocol: 'https',
    },
}

describe('site public URL resolution', () => {
    test('ignores a stale localhost override in production', () => {
        expect(resolveSitePublicUrl({
            platform:      'production',
            configuration: productionConfiguration,
            environment:   {LGS1920_SITE_PUBLIC_URL: 'http://localhost:8080'},
        })).toBe('https://lgs1920.fr')
    })

    test('keeps the local development default', () => {
        expect(resolveSitePublicUrl({
            platform:      'development',
            configuration: productionConfiguration,
            environment:   {},
        })).toBe('http://localhost:8080')
    })

    test('allows an explicit non-production site origin', () => {
        expect(resolveSitePublicUrl({
            platform:      'staging',
            configuration: productionConfiguration,
            environment:   {LGS1920_SITE_PUBLIC_URL: 'https://staging.example.test'},
        })).toBe('https://staging.example.test')
    })
})
