import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'

const DEFAULT_ALLOWED_ORIGINS = {
    development: [
        'http://localhost:5173',
        'http://localhost:8080',
        'https://dev.lgs1920.fr',
    ],
    staging:    ['https://staging.lgs1920.fr'],
    test:       ['https://test.lgs1920.fr'],
    production: [
        'https://studio.lgs1920.fr',
        'https://lgs1920.fr',
    ],
}

/**
 * Normalize one configured browser origin and reject unsafe forms.
 *
 * @param {string} value Candidate origin.
 * @param {boolean} requireHttps Whether HTTP origins must be rejected.
 * @returns {string|null} Normalized origin, or null when invalid.
 */
const normalizeOrigin = (value, requireHttps) => {
    try {
        const url = new URL(value)
        if (!['http:', 'https:'].includes(url.protocol) || (requireHttps && url.protocol !== 'https:') || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
            return null
        }
        return url.origin
    }
    catch {
        return null
    }
}

/**
 * Parse a comma-separated origin allowlist from an environment variable.
 *
 * @param {string|undefined} value Comma-separated origin list.
 * @param {boolean} requireHttps Whether HTTP origins must be rejected.
 * @returns {string[]|null} Normalized origins, or null when unset.
 */
const parseOriginList = (value, requireHttps) => {
    if (value === undefined) {
        return null
    }

    return value
        .split(',')
        .map(origin => origin.trim())
        .map(origin => normalizeOrigin(origin, requireHttps))
        .filter(Boolean)
}

/**
 * Resolve the exact browser origins allowed to call the backend.
 *
 * `LGS1920_ALLOWED_ORIGINS` takes precedence and must contain complete origins
 * including scheme and optional port. Wildcard subdomains are never generated.
 *
 * @param {string} platform Deployment platform name.
 * @returns {string[]} Exact allowed origins.
 */
export const getAllowedOrigins = (platform = 'development') => {
    const requireHttps = platform !== 'development'
    const configuredOrigins = parseOriginList(process.env.LGS1920_ALLOWED_ORIGINS, requireHttps)
    if (configuredOrigins !== null) {
        return configuredOrigins
    }

    return [...(DEFAULT_ALLOWED_ORIGINS[platform] ?? DEFAULT_ALLOWED_ORIGINS.production)]
}

/**
 * Compare two bearer tokens without exposing a timing-based equality shortcut.
 *
 * @param {string} expected Expected server-side token.
 * @param {string} received Request token.
 * @returns {boolean} Whether both tokens match.
 */
const tokensMatch = (expected, received) => {
    const expectedBytes = Buffer.from(expected)
    const receivedBytes = Buffer.from(received)
    if (expectedBytes.length !== receivedBytes.length) {
        return false
    }
    return timingSafeEqual(expectedBytes, receivedBytes)
}

/**
 * Extract a bearer token from an Authorization header.
 *
 * @param {Request} request Incoming request.
 * @returns {string} Bearer token or an empty string.
 */
const getBearerToken = (request) => {
    const authorization = request.headers.get('authorization') ?? ''
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
    return match?.[1]?.trim() ?? ''
}

/**
 * Create a guard for routes that are only reachable by trusted backend services.
 *
 * When no token is configured, local development can remain usable when
 * `allowWithoutToken` is true. Every non-development deployment fails closed.
 *
 * @param {object} options Guard options.
 * @param {boolean} [options.allowWithoutToken=false] Allow local requests without a token.
 * @returns {(context: object) => object|undefined} Elysia beforeHandle guard.
 */
export const createInternalApiGuard = ({allowWithoutToken = false} = {}) => ({request, set}) => {
    const expectedToken = process.env.LGS1920_INTERNAL_API_TOKEN?.trim() ?? ''
    if (!expectedToken) {
        if (allowWithoutToken) {
            return undefined
        }
        set.status = 503
        return {success: false, error: 'Internal API access is not configured'}
    }

    if (!tokensMatch(expectedToken, getBearerToken(request))) {
        set.status = 401
        set.headers['WWW-Authenticate'] = 'Bearer'
        return {success: false, error: 'Internal API authentication required'}
    }

    return undefined
}

/**
 * Add browser and transport hardening headers to every backend response.
 *
 * @param {object} options Header options.
 * @param {boolean} [options.publicHttps=false] Whether the public endpoint is HTTPS.
 * @returns {(context: object) => void} Elysia afterHandle hook.
 */
export const createSecurityHeadersHook = ({publicHttps = false} = {}) => ({set}) => {
    set.headers['X-Content-Type-Options'] = 'nosniff'
    set.headers['X-Frame-Options'] = 'DENY'
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    set.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'

    if (publicHttps) {
        set.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    }
}
