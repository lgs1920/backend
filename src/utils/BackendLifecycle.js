const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000

/**
 * Create the process lifecycle state used by liveness and shutdown handlers.
 *
 * @param {object} options Lifecycle options.
 * @param {Function} options.shutdown Asynchronous shutdown operation.
 * @param {number} [options.timeoutMs=30000] Maximum shutdown duration.
 * @returns {{isDraining: Function, register: Function, requestShutdown: Function}}
 */
export const createBackendLifecycle = ({shutdown, timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS} = {}) => {
    if (typeof shutdown !== 'function') {
        throw new TypeError('Backend shutdown handler is required')
    }

    let draining = false
    let shutdownPromise = null

    const isDraining = () => draining

    const requestShutdown = signal => {
        if (shutdownPromise) {
            return shutdownPromise
        }

        draining = true
        shutdownPromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Backend shutdown timed out after ${timeoutMs} milliseconds`))
            }, timeoutMs)

            Promise.resolve()
                .then(() => shutdown({signal}))
                .then(resolve, reject)
                .finally(() => clearTimeout(timer))
        })

        return shutdownPromise
    }

    const register = () => {
        const handleSignal = signal => {
            requestShutdown(signal)
                .then(() => process.exit(0))
                .catch(error => {
                    console.error(`[ERROR] Backend shutdown failed: ${error.message}`)
                    process.exit(1)
                })
        }

        process.once('SIGINT', () => handleSignal('SIGINT'))
        process.once('SIGTERM', () => handleSignal('SIGTERM'))
    }

    return {isDraining, register, requestShutdown}
}
