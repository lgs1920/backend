import {describe, expect, test} from 'bun:test'
import {resolveSitePublicUrl} from '../src/utils/SitePublicUrl.js'

const productionConfiguration = {
    site: {
        domain:   'lgs1920.fr',
        protocol: 'https',
    },
}

describe('site public URL resolution', () => {
    test('uses the generated production deployment origin', () => {
        expect(resolveSitePublicUrl({
            platform:      'production',
            configuration: productionConfiguration,
        })).toBe('https://lgs1920.fr')
    })

    test('keeps the local development default', () => {
        expect(resolveSitePublicUrl({
            platform:      'development',
            configuration: productionConfiguration,
        })).toBe('http://localhost:8080')
    })

    test('uses the generated staging deployment origin', () => {
        expect(resolveSitePublicUrl({
            platform:      'staging',
            configuration: {
                site: {
                    domain:   'staging.example.test',
                    protocol: 'https',
                },
            },
        })).toBe('https://staging.example.test')
    })

    test('fails when a deployed environment has no site origin', () => {
        expect(() => resolveSitePublicUrl({
            platform:      'production',
            configuration: {},
        })).toThrow('Site deployment URL is not configured')
    })
})
