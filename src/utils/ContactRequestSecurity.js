import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const CONTACT_TARGET_PREFIX = 'LGS1920_CONTACT_TARGET_'
const CONTACT_TARGET_KEY_PATTERN = /^[a-z0-9_-]{4,64}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CONTACT_CSRF_TOKEN_TTL_MS = 15 * 60 * 1000
const CONTACT_CSRF_CLOCK_SKEW_MS = 60 * 1000

/** Error raised when a public contact request fails a security check. */
export class ContactRequestSecurityError extends Error {
    /**
     * Create a contact request security error.
     *
     * @param {string} message Public-safe security message.
     * @param {object} [options] Error options.
     * @param {boolean} [options.configuration=false] Whether the server configuration is unavailable.
     */
    constructor(message, {configuration = false} = {}) {
        super(message)
        this.name = 'ContactRequestSecurityError'
        this.configuration = configuration
    }
}

/**
 * Assert that a request origin belongs to the exact configured browser origins.
 *
 * @param {string|null} origin Browser Origin header.
 * @param {string[]} allowedOrigins Exact configured origins.
 * @returns {void}
 * @throws {ContactRequestSecurityError} If the origin is missing or not allowed.
 */
export const assertContactOrigin = (origin, allowedOrigins) => {
    if (typeof origin !== 'string' || !allowedOrigins.includes(origin)) {
        throw new ContactRequestSecurityError('Contact request origin is not allowed')
    }
}

/**
 * Create a short-lived signed token for the public contact form.
 *
 * @param {object} options Token options.
 * @param {string} options.secret Server-only signing secret.
 * @param {() => number} [options.clock] Clock returning epoch milliseconds.
 * @returns {string} Signed contact form token.
 * @throws {ContactRequestSecurityError} If the signing secret is missing.
 */
export const createContactCsrfToken = ({secret, clock = () => Date.now()} = {}) => {
    if (typeof secret !== 'string' || secret.trim().length < 32) {
        throw new ContactRequestSecurityError('Contact request security is not configured', {configuration: true})
    }

    const payload = `${Math.floor(clock())}.${randomBytes(18).toString('base64url')}`
    const signature = createHmac('sha256', secret).update(payload).digest('base64url')
    return `${payload}.${signature}`
}

/**
 * Validate a signed contact form token and its lifetime.
 *
 * @param {object} options Token validation options.
 * @param {string} options.token Signed token received from the client.
 * @param {string} options.secret Server-only signing secret.
 * @param {() => number} [options.clock] Clock returning epoch milliseconds.
 * @returns {void}
 * @throws {ContactRequestSecurityError} If the token is invalid or expired.
 */
export const assertContactCsrfToken = ({token, secret, clock = () => Date.now()} = {}) => {
    if (typeof token !== 'string' || typeof secret !== 'string' || secret.trim().length < 32) {
        throw new ContactRequestSecurityError('Contact request token is invalid', {configuration: true})
    }

    const parts = token.split('.')
    if (parts.length !== 3) {
        throw new ContactRequestSecurityError('Contact request token is invalid')
    }

    const timestamp = Number(parts[0])
    const now = clock()
    if (!Number.isSafeInteger(timestamp) || timestamp > now + CONTACT_CSRF_CLOCK_SKEW_MS || now - timestamp > CONTACT_CSRF_TOKEN_TTL_MS) {
        throw new ContactRequestSecurityError('Contact request token is expired')
    }

    const payload = `${parts[0]}.${parts[1]}`
    const expectedSignature = createHmac('sha256', secret).update(payload).digest('base64url')
    const expectedBytes = Buffer.from(expectedSignature)
    const receivedBytes = Buffer.from(parts[2])
    if (expectedBytes.length !== receivedBytes.length || !timingSafeEqual(expectedBytes, receivedBytes)) {
        throw new ContactRequestSecurityError('Contact request token is invalid')
    }
}

/**
 * Read the server-side contact target table from environment variables.
 *
 * Variables use the form `LGS1920_CONTACT_TARGET_<opaque-key>=address`.
 *
 * @param {object} [env=process.env] Environment-like configuration.
 * @returns {Record<string, string>} Valid target keys mapped to email addresses.
 */
export const getContactTargetMap = (env = process.env) => Object.entries(env)
    .reduce((targets, [name, value]) => {
        if (!name.startsWith(CONTACT_TARGET_PREFIX) || typeof value !== 'string') {
            return targets
        }

        const key = name.slice(CONTACT_TARGET_PREFIX.length).trim().toLowerCase()
        const address = value.trim()
        if (CONTACT_TARGET_KEY_PATTERN.test(key) && EMAIL_PATTERN.test(address)) {
            targets[key] = address
        }

        return targets
    }, {})

/**
 * Resolve one opaque contact target key without accepting a raw email address.
 *
 * @param {string} targetKey Opaque target key received from the client.
 * @param {object} [env=process.env] Environment-like configuration.
 * @returns {string} Resolved email address.
 * @throws {ContactRequestSecurityError} If the target is unknown or malformed.
 */
export const resolveContactTarget = (targetKey, env = process.env) => {
    const key = typeof targetKey === 'string' ? targetKey.trim().toLowerCase() : ''
    const address = getContactTargetMap(env)[key]
    if (!address) {
        throw new ContactRequestSecurityError('Contact target is invalid')
    }

    return address
}
