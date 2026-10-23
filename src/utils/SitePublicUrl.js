const DEVELOPMENT_PLATFORM = 'development'
const DEVELOPMENT_SITE_PUBLIC_URL = 'http://localhost:8080'

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
 * Deployed environments always use the site origin generated from deployment
 * configuration. Local development keeps its local site origin.
 *
 * @param {object} options Site URL resolution options.
 * @param {string} options.platform Deployment platform.
 * @param {object} options.configuration Generated server configuration.
 * @returns {string} Public site origin.
 * @throws {Error} If a deployed environment has no site origin configured.
 */
export const resolveSitePublicUrl = ({platform, configuration} = {}) => {
    if (platform === DEVELOPMENT_PLATFORM) {
        return DEVELOPMENT_SITE_PUBLIC_URL
    }

    const deploymentSiteUrl = buildConfiguredSiteUrl(configuration)

    if (!deploymentSiteUrl) {
        throw new Error('Site deployment URL is not configured')
    }

    return deploymentSiteUrl
}
