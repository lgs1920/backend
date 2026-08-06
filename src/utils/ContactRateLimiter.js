const DEFAULT_WINDOW_MS = 15 * 60 * 1000
const DEFAULT_TOKEN_LIMIT = 10
const DEFAULT_SEND_LIMIT = 5
const DEFAULT_MAX_ENTRIES = 10_000

/**
 * Resolve the client address without trusting forwarded headers by default.
 *
 * @param {object} context Elysia request context.
 * @param {boolean} trustProxy Whether the deployment explicitly trusts its reverse proxy.
 * @returns {string} Stable client identifier for rate limiting.
 */
const getClientAddress = ({request, server}, trustProxy) => {
    if (trustProxy) {
        const forwardedFor = request.headers.get('x-forwarded-for')
        const forwardedAddress = forwardedFor?.split(',')[0]?.trim()
        if (forwardedAddress) {
            return forwardedAddress
        }
    }

    const remoteAddress = server?.requestIP?.(request)?.address
    return remoteAddress || 'unknown'
}

/**
 * Validate one positive integer rate-limiter setting.
 *
 * @param {*} value Candidate setting.
 * @param {string} name Setting name.
 * @param {number} fallback Default setting.
 * @returns {number} Validated setting.
 */
const readPositiveInteger = (value, name, fallback) => {
    const resolved = value ?? fallback
    if (!Number.isSafeInteger(resolved) || resolved < 1) {
        throw new TypeError(`${name} must be a positive integer`)
    }

    return resolved
}

/**
 * Limit public contact requests per client and endpoint scope.
 */
export class ContactRateLimiter {
    /**
     * @param {object} [options] Limiter options.
     * @param {number} [options.windowMs] Fixed window duration in milliseconds.
     * @param {number} [options.tokenLimit] Maximum token requests per window.
     * @param {number} [options.sendLimit] Maximum message sends per window.
     * @param {number} [options.maxEntries] Maximum in-memory client buckets.
     * @param {boolean} [options.trustProxy=false] Trust the first X-Forwarded-For address.
     * @param {() => number} [options.clock] Clock returning epoch milliseconds.
     * @param {(context: object) => string} [options.getClientKey] Optional client-key resolver.
     */
    constructor({
        windowMs = DEFAULT_WINDOW_MS,
        tokenLimit = DEFAULT_TOKEN_LIMIT,
        sendLimit = DEFAULT_SEND_LIMIT,
        maxEntries = DEFAULT_MAX_ENTRIES,
        trustProxy = false,
        clock = () => Date.now(),
        getClientKey = null,
    } = {}) {
        this.windowMs = readPositiveInteger(windowMs, 'windowMs', DEFAULT_WINDOW_MS)
        this.tokenLimit = readPositiveInteger(tokenLimit, 'tokenLimit', DEFAULT_TOKEN_LIMIT)
        this.sendLimit = readPositiveInteger(sendLimit, 'sendLimit', DEFAULT_SEND_LIMIT)
        this.maxEntries = readPositiveInteger(maxEntries, 'maxEntries', DEFAULT_MAX_ENTRIES)
        this.trustProxy = trustProxy === true
        this.clock = clock
        this.getClientKey = getClientKey ?? (context => getClientAddress(context, this.trustProxy))
        this.buckets = new Map()
    }

    /**
     * Remove expired buckets and keep memory bounded.
     *
     * @param {number} now Current epoch milliseconds.
     * @returns {void}
     */
    prune = (now) => {
        for (const [key, bucket] of this.buckets) {
            if (now - bucket.startedAt >= this.windowMs) {
                this.buckets.delete(key)
            }
        }

        while (this.buckets.size >= this.maxEntries) {
            const oldestKey = this.buckets.keys().next().value
            if (oldestKey === undefined) {
                break
            }
            this.buckets.delete(oldestKey)
        }
    }

    /**
     * Consume one request from a scoped client bucket.
     *
     * @param {'token'|'send'} scope Endpoint scope.
     * @param {object} context Elysia request context.
     * @returns {{retryAfterSeconds: number}|null} Rate-limit result, or null when allowed.
     */
    check = (scope, context) => {
        const limit = scope === 'token' ? this.tokenLimit : scope === 'send' ? this.sendLimit : 0
        if (!limit) {
            throw new TypeError('Unknown contact rate-limit scope')
        }

        const now = this.clock()
        this.prune(now)
        const clientKey = String(this.getClientKey(context) || 'unknown')
        const bucketKey = `${scope}:${clientKey}`
        const bucket = this.buckets.get(bucketKey)

        if (!bucket || now - bucket.startedAt >= this.windowMs) {
            this.buckets.set(bucketKey, {startedAt: now, count: 1})
            return null
        }

        if (bucket.count >= limit) {
            return {
                retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + this.windowMs - now) / 1000)),
            }
        }

        bucket.count += 1
        return null
    }
}
