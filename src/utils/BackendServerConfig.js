const LEGACY_DEFAULT_BACKEND_HOST = '0.0.0.0'

/**
 * Resolve the backend bind address while preserving legacy deployments that
 * do not provide a local reverse proxy.
 *
 * @param {object} options Backend host sources.
 * @param {string} [options.environmentHost] Environment-provided bind address.
 * @param {string} [options.configuredHost] Server configuration bind address.
 * @returns {string} The resolved backend bind address.
 */
export const resolveBackendHost = ({environmentHost, configuredHost} = {}) => {
    const environmentValue = typeof environmentHost === 'string' ? environmentHost.trim() : ''
    const configuredValue = typeof configuredHost === 'string' ? configuredHost.trim() : ''

    return environmentValue || configuredValue || LEGACY_DEFAULT_BACKEND_HOST
}
