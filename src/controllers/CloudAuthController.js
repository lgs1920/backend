/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: CloudAuthController.js                                                                                       *
 *                                                                                                                    *
 * Author : LGS1920 Team                                                                                              *
 * email: contact@lgs1920.fr                                                                                          *
 *                                                                                                                    *
 * Created on: 2026-05-02                                                                                             *
 * Last modified: 2026-05-02                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2026 LGS1920                                                                                           *
 **********************************************************************************************************************/

import { configuration } from '../index.js'
import {
    CLOUD_PROVIDER_DROPBOX,
    CLOUD_PROVIDER_GOOGLE,
    CLOUD_PROVIDER_NEXTCLOUD,
    CLOUD_PROVIDER_ONEDRIVE,
    CLOUD_PROVIDER_PCLOUD,
    CLOUD_SESSION_COOKIE,
    connectedProviders,
    consumeOAuthState,
    createOAuthState,
    deleteCloudSession,
    getCloudSessionId,
    pkceChallenge,
    randomToken,
    setCloudTokens,
}                        from '../utils/CloudOAuthStore.js'

const stripTrailingSlash = value => `${value ?? ''}`.replace(/\/$/, '')

const nextcloudBaseUrl = () => stripTrailingSlash(process.env.LGS1920_NEXTCLOUD_BASE_URL)
const CLOUD_OAUTH_ENABLED = process.env.LGS1920_CLOUD_OAUTH_ENABLED === 'true'
const CLOUD_OAUTH_NOT_AVAILABLE_MESSAGE = 'Cloud account connection is not available yet.'

const PROVIDERS = {
    [CLOUD_PROVIDER_ONEDRIVE]:  {
        authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl:     'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        clientId:     () => process.env.LGS1920_ONEDRIVE_CLIENT_ID,
        clientSecret: () => process.env.LGS1920_ONEDRIVE_CLIENT_SECRET,
        scopes:       () => process.env.LGS1920_ONEDRIVE_SCOPES ?? 'offline_access Files.ReadWrite User.Read',
        startParams:  () => ({}),
        usePkce:      true,
    },
    [CLOUD_PROVIDER_GOOGLE]:    {
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl:     'https://oauth2.googleapis.com/token',
        clientId:     () => process.env.LGS1920_GOOGLE_CLIENT_ID,
        clientSecret: () => process.env.LGS1920_GOOGLE_CLIENT_SECRET,
        scopes:       () => process.env.LGS1920_GOOGLE_SCOPES ?? 'https://www.googleapis.com/auth/drive.readonly',
        startParams:  () => ({
            access_type:            'offline',
            include_granted_scopes: 'true',
            prompt:                 'consent',
        }),
        usePkce:      true,
    },
    [CLOUD_PROVIDER_DROPBOX]:   {
        authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
        tokenUrl:     'https://api.dropboxapi.com/oauth2/token',
        clientId:     () => process.env.LGS1920_DROPBOX_CLIENT_ID,
        clientSecret: () => process.env.LGS1920_DROPBOX_CLIENT_SECRET,
        scopes:       () => process.env.LGS1920_DROPBOX_SCOPES ?? 'files.content.read sharing.read',
        startParams:  () => ({
            token_access_type: 'offline',
        }),
        usePkce:      true,
    },
    [CLOUD_PROVIDER_PCLOUD]:    {
        authorizeUrl: 'https://my.pcloud.com/oauth2/authorize',
        tokenUrl:     'https://api.pcloud.com/oauth2_token',
        clientId:     () => process.env.LGS1920_PCLOUD_CLIENT_ID,
        clientSecret: () => process.env.LGS1920_PCLOUD_CLIENT_SECRET,
        scopes:       () => '',
        startParams:  () => ({}),
        usePkce:      false,
        tokenMethod:  'GET',
    },
    [CLOUD_PROVIDER_NEXTCLOUD]: {
        authorizeUrl: () => nextcloudBaseUrl() ? `${nextcloudBaseUrl()}/index.php/apps/oauth2/authorize` : '',
        tokenUrl:     () => nextcloudBaseUrl() ? `${nextcloudBaseUrl()}/index.php/apps/oauth2/api/v1/token` : '',
        clientId:     () => process.env.LGS1920_NEXTCLOUD_CLIENT_ID,
        clientSecret: () => process.env.LGS1920_NEXTCLOUD_CLIENT_SECRET,
        scopes:       () => process.env.LGS1920_NEXTCLOUD_SCOPES ?? '',
        startParams:  () => ({}),
        usePkce:      false,
    },
}

const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60
const allowedReturnHosts = ['localhost', '127.0.0.1', 'dev.lgs1920.fr']

class CloudAuthError extends Error {

    constructor(message, status = 400) {
        super(message)
        this.name = 'CloudAuthError'
        this.status = status
    }
}

const backendBaseUrl = () => {
    const configured = process.env.LGS1920_BACKEND_PUBLIC_URL
    if (configured) {
        return configured.replace(/\/$/, '')
    }

    return `${configuration.backend.protocol}://${configuration.backend.domain}:${configuration.backend.port}`
}

const studioBaseUrl = () => {
    const configured = process.env.LGS1920_STUDIO_PUBLIC_URL
    if (configured) {
        return configured.replace(/\/$/, '')
    }

    const port = configuration.studio.port ? `:${configuration.studio.port}` : ''
    return `${configuration.studio.protocol}://${configuration.studio.domain}${port}`
}

const redirectUri = (provider) => {
    return process.env[`LGS1920_${provider.toUpperCase()}_REDIRECT_URI`] ?? `${backendBaseUrl()}/cloud-auth/${provider}/callback`
}

const providerValue = (value) => typeof value === 'function' ? value() : value

const isAllowedReturnUrl = (value) => {
    try {
        const url = new URL(value)
        return ['http:', 'https:'].includes(url.protocol)
            && (allowedReturnHosts.includes(url.hostname) || url.hostname.endsWith('.lgs1920.fr'))
    }
    catch {
        return false
    }
}

const normalizeReturnUrl = (returnUrl) => {
    return isAllowedReturnUrl(returnUrl) ? returnUrl : studioBaseUrl()
}

const redirectResponse = ({url, headers = {}}) => {
    return new Response(null, {
        status:  302,
        headers: {
            Location: url,
            ...headers,
        },
    })
}

const cookieAttributes = (maxAge = SESSION_COOKIE_MAX_AGE) => {
    const secure = process.env.LGS1920_COOKIE_SECURE === 'true' || configuration.studio.protocol === 'https'
    return [
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${maxAge}`,
        secure ? 'Secure' : '',
    ].filter(Boolean).join('; ')
}

const serializeSessionCookie = (sessionId) => {
    return `${CLOUD_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; ${cookieAttributes()}`
}

const clearSessionCookie = () => {
    return `${CLOUD_SESSION_COOKIE}=; ${cookieAttributes(0)}`
}

const appendAuthStatus = ({returnUrl, provider, status, message = ''}) => {
    const url = new URL(returnUrl)
    url.searchParams.set('cloudAuth', provider)
    url.searchParams.set('cloudAuthStatus', status)
    if (message) {
        url.searchParams.set('cloudAuthMessage', message)
    }
    return url.href
}

const providerConfig = (provider) => {
    const config = PROVIDERS[provider]
    if (!config) {
        throw new CloudAuthError('Unsupported cloud provider.', 404)
    }
    if (!config.clientId()) {
        throw new CloudAuthError(`Missing ${provider} OAuth client id.`, 501)
    }
    if (!providerValue(config.authorizeUrl) || !providerValue(config.tokenUrl)) {
        throw new CloudAuthError(`Missing ${provider} OAuth endpoint configuration.`, 501)
    }

    return config
}

const tokenPayloadFromBody = ({provider, body, query}) => {
    const expiresIn = body.expires_in ? Number(body.expires_in) : null
    return {
        accessToken:  body.access_token,
        refreshToken: body.refresh_token,
        expiresAt:    expiresIn ? Date.now() + (expiresIn * 1000) : null,
        scope:        body.scope,
        tokenType:    body.token_type,
        apiHost:      body.hostname ?? query?.hostname,
        locationId:   body.locationid ?? query?.locationid,
        provider,
    }
}

const exchangeAuthorizationCode = async ({provider, code, codeVerifier, query}) => {
    const config = providerConfig(provider)
    const payload = new URLSearchParams({
                                            client_id:    config.clientId(),
                                            code,
                                            redirect_uri: redirectUri(provider),
                                            grant_type:   'authorization_code',
                                        })

    const scopes = config.scopes()
    if (scopes && provider !== CLOUD_PROVIDER_DROPBOX && provider !== CLOUD_PROVIDER_PCLOUD) {
        payload.set('scope', scopes)
    }
    if (config.usePkce && codeVerifier) {
        payload.set('code_verifier', codeVerifier)
    }

    const clientSecret = config.clientSecret()
    if (clientSecret) {
        payload.set('client_secret', clientSecret)
    }

    const tokenUrl = new URL(provider === CLOUD_PROVIDER_PCLOUD && query?.hostname
                             ? `https://${query.hostname}/oauth2_token`
                             : providerValue(config.tokenUrl))
    const tokenOptions = {
        method:  config.tokenMethod ?? 'POST',
        headers: {'content-type': 'application/x-www-form-urlencoded'},
    }
    if (tokenOptions.method === 'GET') {
        for (const [key, value] of payload.entries()) {
            tokenUrl.searchParams.set(key, value)
        }
    }
    else {
        tokenOptions.body = payload
    }

    const response = await fetch(tokenUrl.href, tokenOptions)
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body.result > 0) {
        throw new CloudAuthError(body.error_description ?? body.error ?? 'OAuth token exchange failed.', 502)
    }

    return tokenPayloadFromBody({provider, body, query})
}

export class CloudAuthController {

    start = ({params: {provider}, query}) => {
        try {
            if (!CLOUD_OAUTH_ENABLED) {
                return new Response(CLOUD_OAUTH_NOT_AVAILABLE_MESSAGE, {status: 501})
            }

            const config = providerConfig(provider)
            const codeVerifier = randomToken(64)
            const returnUrl = normalizeReturnUrl(query?.returnUrl)
            const state = createOAuthState({provider, returnUrl, codeVerifier})
            const authorizeUrl = new URL(providerValue(config.authorizeUrl))

            authorizeUrl.searchParams.set('client_id', config.clientId())
            authorizeUrl.searchParams.set('response_type', 'code')
            authorizeUrl.searchParams.set('redirect_uri', redirectUri(provider))
            authorizeUrl.searchParams.set('state', state)
            if (provider !== CLOUD_PROVIDER_PCLOUD) {
                authorizeUrl.searchParams.set('response_mode', 'query')
            }
            const scopes = config.scopes()
            if (scopes) {
                authorizeUrl.searchParams.set('scope', scopes)
            }
            if (config.usePkce) {
                authorizeUrl.searchParams.set('code_challenge', pkceChallenge(codeVerifier))
                authorizeUrl.searchParams.set('code_challenge_method', 'S256')
            }
            for (const [key, value] of Object.entries(config.startParams())) {
                authorizeUrl.searchParams.set(key, value)
            }

            return redirectResponse({url: authorizeUrl.href})
        }
        catch (error) {
            return new Response(error.message ?? 'OAuth start failed.', {status: error.status ?? 500})
        }
    }

    callback = async ({params: {provider}, query, request}) => {
        const state = consumeOAuthState(query?.state)
        const returnUrl = normalizeReturnUrl(state?.returnUrl)

        try {
            if (!CLOUD_OAUTH_ENABLED) {
                throw new CloudAuthError(CLOUD_OAUTH_NOT_AVAILABLE_MESSAGE, 501)
            }

            if (!state || state.provider !== provider) {
                throw new CloudAuthError('Invalid OAuth state.')
            }
            if (query?.error) {
                throw new CloudAuthError(query.error_description ?? query.error)
            }
            if (!query?.code) {
                throw new CloudAuthError('Missing OAuth authorization code.')
            }

            const tokens = await exchangeAuthorizationCode({
                                                               provider,
                                                               code:         query.code,
                                                               codeVerifier: state.codeVerifier,
                                                               query,
                                                           })
            const sessionId = setCloudTokens({
                                                 sessionId: getCloudSessionId(request) || undefined,
                                                 provider,
                                                 tokens,
                                             })

            return redirectResponse({
                                        url:     appendAuthStatus({returnUrl, provider, status: 'connected'}),
                                        headers: {'Set-Cookie': serializeSessionCookie(sessionId)},
                                    })
        }
        catch (error) {
            return redirectResponse({
                                        url: appendAuthStatus({
                                                                  returnUrl,
                                                                  provider,
                                                                  status:  'failed',
                                                                  message: error.message ?? 'OAuth authentication failed.',
                                                              }),
                                    })
        }
    }

    status = ({request}) => {
        return {
            available: CLOUD_OAUTH_ENABLED,
            providers: connectedProviders(getCloudSessionId(request)),
        }
    }

    logout = ({request}) => {
        deleteCloudSession(getCloudSessionId(request))
        return new Response(JSON.stringify({success: true}), {
            status:  200,
            headers: {
                'content-type': 'application/json',
                'Set-Cookie':   clearSessionCookie(),
            },
        })
    }
}
