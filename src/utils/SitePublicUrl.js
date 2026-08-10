const DEVELOPMENT_PLATFORM = 'development'
const PRODUCTION_PLATFORM = 'production'
const DEVELOPMENT_SITE_PUBLIC_URL = 'http://localhost:8080'
const PRODUCTION_SITE_PUBLIC_URL = 'https://lgs1920.fr'

/**
 * Build the public site origin from generated deployment configuration.
 *
 * @param {object} configuration Generated server configuration.
 * @returns {string} Configured site origin, or an empty string when incomplete.
 */
const buildConfiguredSiteUrl = (configuration = {}) => {
    const protocol = typeof configuration.site?.protocol === 'string' ? configuration.site.protocol.trim() : ''
    const domain = typeof configuration.site?.domain === 'string' ? configuration.site.domain.trim() : ''

    return protocol && domain ? `${protocol}://${domain}` : ''
}

/**
 * Resolve the public site origin used by server-generated links.
 *
 * Production always uses the generated deployment site origin so a stale local
 * environment value cannot leak localhost links into public emails.
 *
 * @param {object} options Site URL resolution options.
 * @param {string} options.platform Deployment platform.
 * @param {object} options.configuration Generated server configuration.
 * @param {object} [options.environment=process.env] Environment-like values.
 * @returns {string} Public site origin.
 */
export const resolveSitePublicUrl = ({platform, configuration, environment = process.env} = {}) => {
    const configuredUrl = typeof environment?.LGS1920_SITE_PUBLIC_URL === 'string'
        ? environment.LGS1920_SITE_PUBLIC_URL.trim()
        : ''
    const deploymentSiteUrl = buildConfiguredSiteUrl(configuration)

    if (platform === PRODUCTION_PLATFORM) {
        return deploymentSiteUrl || PRODUCTION_SITE_PUBLIC_URL
    }

    if (configuredUrl) {
        return configuredUrl
    }

    return platform === DEVELOPMENT_PLATFORM
        ? DEVELOPMENT_SITE_PUBLIC_URL
        : deploymentSiteUrl || PRODUCTION_SITE_PUBLIC_URL
}
