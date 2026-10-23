/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: JourneyImportController.js                                                                                   *
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

import { Buffer }     from 'node:buffer'
import { Controller } from './Controller.js'
import {
    CLOUD_PROVIDER_DROPBOX,
    CLOUD_PROVIDER_GOOGLE,
    CLOUD_PROVIDER_ICLOUD,
    CLOUD_PROVIDER_NEXTCLOUD,
    CLOUD_PROVIDER_ONEDRIVE,
    CLOUD_PROVIDER_PCLOUD,
    getCloudSessionId,
    getCloudTokens,
    hasUsableAccessToken,
    updateCloudTokens,
}                     from '../utils/CloudOAuthStore.js'

const SUPPORTED_EXTENSIONS = ['geojson', 'json', 'kml', 'gpx']
const DEFAULT_FILE_NAME = 'remote-journey'
const MAX_REMOTE_JOURNEY_BYTES = 25 * 1024 * 1024
const REMOTE_JOURNEY_FETCH_TIMEOUT_MS = 20000
const MAX_REMOTE_REDIRECTS = 5
const CLOUD_OAUTH_ENABLED = process.env.LGS1920_CLOUD_OAUTH_ENABLED === 'true'
const CLOUD_AUTH_ERROR_MESSAGE = 'Private cloud links are not available yet. Use a public sharing link.'
const CLOUD_AUTH_ERROR_STATUS = 422
const CLOUD_AUTH_REQUIRED_MESSAGE = 'A secure cloud connection is required before this file can be imported.'
const CLOUD_ACCESS_DENIED_MESSAGE = 'The connected account cannot access this file, or the sharing permissions do not allow import.'
const CLOUD_READ_ERROR_MESSAGE = 'The cloud provider did not return a readable file. Check the sharing settings or try again later.'
const GRAPH_SHARE_SCOPE = 'redeemSharingLinkIfNecessary'
const NEXTCLOUD_PUBLIC_SHARE_PATTERN = /\/(?:index\.php\/)?s\/([^/?#]+)/
const REMOTE_IMPORT_ERROR_CODES = {
    CLOUD_ACCESS_DENIED:  'cloud_access_denied',
    CLOUD_AUTH_REQUIRED:  'cloud_auth_required',
    CLOUD_NOT_CONFIGURED: 'cloud_not_configured',
    CLOUD_PRIVATE_LINK:   'cloud_private_link',
    CLOUD_READ_FAILED:    'cloud_read_failed',
    REMOTE_TIMEOUT:       'remote_timeout',
    REMOTE_TOO_LARGE:     'remote_file_too_large',
    UNSUPPORTED_FORMAT:   'unsupported_format',
}

class RemoteJourneyImportError extends Error {

    constructor(message, status = 400, details = {}) {
        super(message)
        this.name = 'RemoteJourneyImportError'
        this.status = status
        this.details = details
    }
}

const toBase64Url = (value) => {
    return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const getPathFilename = (url) => {
    const segment = url.pathname.split('/').filter(Boolean).pop() ?? ''
    try {
        return decodeURIComponent(segment)
    }
    catch {
        return segment
    }
}

const getExtension = (fileName = '') => {
    const match = fileName.match(/\.([a-z0-9]+)$/i)
    const extension = match?.[1]?.toLowerCase() ?? ''
    return SUPPORTED_EXTENSIONS.includes(extension) ? extension : ''
}

const getFileBaseName = (fileName = '') => {
    const filename = fileName.split(/[\\/]/).pop() || DEFAULT_FILE_NAME
    return filename.replace(/\.[^.]+$/, '') || DEFAULT_FILE_NAME
}

const getFilenameFromContentDisposition = (value = '') => {
    const utfMatch = value.match(/filename\*=UTF-8''([^;]+)/i)
    if (utfMatch?.[1]) {
        try {
            return decodeURIComponent(utfMatch[1].trim().replace(/^["']|["']$/g, ''))
        }
        catch {
            return utfMatch[1].trim().replace(/^["']|["']$/g, '')
        }
    }

    const asciiMatch = value.match(/filename="?([^";]+)"?/i)
    return asciiMatch?.[1]?.trim() ?? ''
}

const matchesDomain = (hostname, domain) => {
    const host = hostname.toLowerCase()
    return host === domain || host.endsWith(`.${domain}`)
}

const envPrefix = (provider) => provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')

const getClientId = (provider) => process.env[`LGS1920_${envPrefix(provider)}_CLIENT_ID`]

const getClientSecret = (provider) => process.env[`LGS1920_${envPrefix(provider)}_CLIENT_SECRET`]

const nextcloudBaseUrl = () => `${process.env.LGS1920_NEXTCLOUD_BASE_URL ?? ''}`.replace(/\/$/, '')

const matchesConfiguredNextcloud = (url) => {
    const baseUrl = nextcloudBaseUrl()
    if (!baseUrl) {
        return false
    }

    try {
        return url.hostname.toLowerCase() === new URL(baseUrl).hostname.toLowerCase()
    }
    catch {
        return false
    }
}

const detectCloudProvider = (url) => {
    const host = url.hostname.toLowerCase()
    if (matchesDomain(host, 'drive.google.com') || matchesDomain(host, 'docs.google.com')) {
        return CLOUD_PROVIDER_GOOGLE
    }
    if (matchesDomain(host, 'dropbox.com') || matchesDomain(host, 'dropboxusercontent.com')) {
        return CLOUD_PROVIDER_DROPBOX
    }
    if (matchesDomain(host, '1drv.ms') || matchesDomain(host, 'onedrive.live.com') || matchesDomain(host, 'sharepoint.com')) {
        return CLOUD_PROVIDER_ONEDRIVE
    }
    if (matchesDomain(host, 'pcloud.com') || matchesDomain(host, 'pcloud.link')) {
        return CLOUD_PROVIDER_PCLOUD
    }
    if (matchesDomain(host, 'icloud.com') || matchesDomain(host, 'icloud.com.cn')) {
        return CLOUD_PROVIDER_ICLOUD
    }
    if (matchesConfiguredNextcloud(url) || NEXTCLOUD_PUBLIC_SHARE_PATTERN.test(url.pathname)) {
        return CLOUD_PROVIDER_NEXTCLOUD
    }

    return ''
}

const isPrivateIpv4 = (hostname) => {
    const parts = hostname.split('.').map(part => Number(part))
    if (parts.length !== 4 || parts.some(part => Number.isNaN(part) || part < 0 || part > 255)) {
        return false
    }

    const [a, b] = parts
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}

const isBlockedHostname = (hostname) => {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
    const ipv4MappedHost = host.startsWith('::ffff:') ? host.slice(7) : host
    return !host
        || host === 'localhost'
        || host.endsWith('.localhost')
        || isPrivateIpv4(host)
        || isPrivateIpv4(ipv4MappedHost)
        || host === '::'
        || host === '::1'
        || host === '0:0:0:0:0:0:0:1'
        || host.startsWith('fc')
        || host.startsWith('fd')
        || host.startsWith('fe80:')
}

const fetchWithCheckedRedirects = async (url, signal, options = {}) => {
    const initialHost = url.hostname
    let currentUrl = new URL(url.href)

    for (let index = 0; index <= MAX_REMOTE_REDIRECTS; index++) {
        if (isBlockedHostname(currentUrl.hostname)) {
            throw new RemoteJourneyImportError('This URL host is not allowed.')
        }

        const headers = {...(options.headers ?? {})}
        if (currentUrl.hostname !== initialHost) {
            delete headers.Authorization
        }

        const response = await fetch(currentUrl.href, {
            cache:    'no-store',
            redirect: 'manual',
            signal,
            headers,
        })

        if (![301, 302, 303, 307, 308].includes(response.status)) {
            return {response, responseUrl: currentUrl.href}
        }

        const location = response.headers.get('location')
        if (!location) {
            throw new RemoteJourneyImportError('Remote file redirect is invalid.', 502)
        }

        currentUrl = new URL(location, currentUrl.href)
    }

    throw new RemoteJourneyImportError('Remote file has too many redirects.', 502)
}

const normalizeGoogleDriveUrl = (url) => {
    if (!matchesDomain(url.hostname, 'drive.google.com')) {
        return null
    }

    const fileId = url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ?? url.searchParams.get('id')
    if (!fileId) {
        return null
    }

    return new URL(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`)
}

const normalizeDropboxUrl = (url) => {
    const host = url.hostname.toLowerCase()
    if (!matchesDomain(host, 'dropbox.com') && !matchesDomain(host, 'dropboxusercontent.com')) {
        return null
    }

    const directUrl = new URL(url.href)
    if (!matchesDomain(host, 'dropboxusercontent.com')) {
        directUrl.searchParams.delete('raw')
        directUrl.searchParams.set('dl', '1')
    }

    return directUrl
}

const normalizeOneDriveUrl = (url) => {
    const host = url.hostname.toLowerCase()
    const isOneDriveUrl = matchesDomain(host, '1drv.ms') || matchesDomain(host, 'onedrive.live.com') || matchesDomain(host, 'sharepoint.com')
    if (!isOneDriveUrl) {
        return null
    }

    const resourceId = url.searchParams.get('resid')
    if (matchesDomain(host, 'onedrive.live.com') && resourceId) {
        const directUrl = new URL('https://onedrive.live.com/download')
        directUrl.searchParams.set('resid', resourceId)
        const authKey = url.searchParams.get('authkey')
        if (authKey) {
            directUrl.searchParams.set('authkey', authKey)
        }
        return directUrl
    }

    return new URL(`https://api.onedrive.com/v1.0/shares/u!${toBase64Url(url.href)}/root/content`)
}

const normalizeNextcloudUrl = (url) => {
    const share = url.pathname.match(NEXTCLOUD_PUBLIC_SHARE_PATTERN)?.[1]
    if (!share) {
        return null
    }

    const directUrl = new URL(url.href)
    const prefix = url.pathname.includes('/index.php/s/') ? '/index.php/s' : '/s'
    directUrl.pathname = `${prefix}/${share}/download`
    directUrl.search = ''
    directUrl.hash = ''
    return directUrl
}

const extractGoogleDriveFileId = (url) => {
    return url.pathname.match(/\/file\/d\/([^/]+)/)?.[1]
        ?? url.pathname.match(/\/d\/([^/]+)/)?.[1]
        ?? url.searchParams.get('id')
}

const extractPCloudCode = (url) => {
    return url.searchParams.get('code') ?? url.pathname.match(/\/(?:publink\/show|show)\/([^/?#]+)/)?.[1] ?? ''
}

const pCloudApiHost = (tokens = null) => {
    return tokens?.apiHost ?? process.env.LGS1920_PCLOUD_API_HOST ?? 'api.pcloud.com'
}

const normalizeRemoteJourneyUrl = (rawUrl) => {
    const trimmed = `${rawUrl ?? ''}`.trim()
    if (!trimmed) {
        throw new RemoteJourneyImportError('Missing URL.')
    }

    let url
    try {
        const href = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
        url = new URL(href)
    }
    catch {
        throw new RemoteJourneyImportError('Invalid URL.')
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new RemoteJourneyImportError('Only HTTP and HTTPS URLs are supported.')
    }
    if (isBlockedHostname(url.hostname)) {
        throw new RemoteJourneyImportError('This URL host is not allowed.')
    }

    const downloadUrl = normalizeGoogleDriveUrl(url) ?? normalizeDropboxUrl(url) ?? normalizeOneDriveUrl(url) ?? normalizeNextcloudUrl(url) ?? url
    if (isBlockedHostname(downloadUrl.hostname)) {
        throw new RemoteJourneyImportError('This URL host is not allowed.')
    }

    return {sourceUrl: url, downloadUrl, provider: detectCloudProvider(url)}
}

const inferExtensionFromContent = (content, contentType = '') => {
    const type = contentType.toLowerCase()
    if (type.includes('gpx')) {
        return 'gpx'
    }
    if (type.includes('kml')) {
        return 'kml'
    }
    if (type.includes('geo+json')) {
        return 'geojson'
    }
    if (type.includes('json')) {
        return 'json'
    }

    const sample = content.trimStart().slice(0, 500).toLowerCase()
    if (sample.startsWith('<gpx') || sample.includes('<gpx')) {
        return 'gpx'
    }
    if (sample.startsWith('<kml') || sample.includes('<kml')) {
        return 'kml'
    }
    if (sample.startsWith('{') || sample.startsWith('[')) {
        try {
            const data = JSON.parse(content)
            return ['Feature', 'FeatureCollection'].includes(data?.type) ? 'geojson' : 'json'
        }
        catch {
            return 'json'
        }
    }

    return ''
}

const looksLikeHtmlPage = (content) => {
    const sample = content.trimStart().slice(0, 200).toLowerCase()
    return sample.startsWith('<!doctype html') || sample.startsWith('<html') || sample.includes('<html ')
}

const looksLikeCloudLoginPage = (content) => {
    const sample = content.toLowerCase()
    return sample.includes('login.live.com')
        || sample.includes('"isauthenticated":false')
        || sample.includes('signinurl')
        || sample.includes('accounts.google.com')
        || sample.includes('dropbox.com/login')
        || (sample.includes('pcloud') && sample.includes('login'))
        || (sample.includes('nextcloud') && sample.includes('login'))
}

const resolveRemoteFileInfo = ({sourceUrl, responseUrl, contentDisposition, contentType, content, size}) => {
    const candidates = [
        getFilenameFromContentDisposition(contentDisposition),
        getPathFilename(new URL(responseUrl)),
        getPathFilename(sourceUrl),
    ].filter(Boolean)

    const candidate = candidates.find(name => getExtension(name)) ?? candidates[0] ?? DEFAULT_FILE_NAME
    const extension = getExtension(candidate) || inferExtensionFromContent(content, contentType)
    const name = getExtension(candidate) ? getFileBaseName(candidate) : getFileBaseName(candidate) || DEFAULT_FILE_NAME

    return {
        fullName: extension ? `${name}.${extension}` : name,
        name,
        extension,
        type:     contentType,
        size,
    }
}

const fetchJson = async (url, options = {}) => {
    const response = await fetch(url, options)
    const body = await response.json().catch(() => ({}))
    return {response, body}
}

const toTokenPayload = (body, previousTokens = {}) => {
    return {
        accessToken:  body.access_token,
        refreshToken: body.refresh_token ?? previousTokens.refreshToken,
        expiresAt:    Date.now() + ((body.expires_in ?? 3600) * 1000),
        scope:        body.scope ?? previousTokens.scope,
        tokenType:    body.token_type ?? previousTokens.tokenType,
    }
}

export class JourneyImportController extends Controller {

    importFromUrl = async ({body, set, request}) => {
        try {
            const {sourceUrl, downloadUrl, provider} = normalizeRemoteJourneyUrl(body?.url)
            const remote = await this.#fetchCloudJourney({provider, sourceUrl, downloadUrl, request})
            const file = resolveRemoteFileInfo({
                                                   sourceUrl,
                                                   responseUrl:        remote.responseUrl,
                                                   contentDisposition: remote.contentDisposition,
                                                   contentType:        remote.contentType,
                                                   content:            remote.content,
                                                   size:               remote.size,
                                               })

            if (!SUPPORTED_EXTENSIONS.includes(file.extension)) {
                throw new RemoteJourneyImportError('Unsupported file format.', 415, {
                    errorCode: REMOTE_IMPORT_ERROR_CODES.UNSUPPORTED_FORMAT,
                })
            }

            return {
                success:     true,
                content:     remote.content,
                file,
                sourceUrl:   sourceUrl.href,
                downloadUrl: downloadUrl.href,
                responseUrl: remote.responseUrl,
            }
        }
        catch (error) {
            const isImportError = error instanceof RemoteJourneyImportError
            const status = isImportError ? error.status : 500
            set.status = isImportError ? 200 : status
            return {
                success: false,
                status,
                ...error.details,
                error: error.message ?? 'Remote import failed.',
            }
        }
    }

    #fetchCloudJourney = async ({provider, sourceUrl, downloadUrl, request}) => {
        switch (provider) {
            case CLOUD_PROVIDER_ONEDRIVE:
                return this.#fetchOneDriveJourney({sourceUrl, downloadUrl, request})
            case CLOUD_PROVIDER_GOOGLE:
                return this.#fetchGoogleDriveJourney({sourceUrl, downloadUrl, request})
            case CLOUD_PROVIDER_DROPBOX:
                return this.#fetchDropboxJourney({sourceUrl, downloadUrl, request})
            case CLOUD_PROVIDER_PCLOUD:
                return this.#fetchPCloudJourney({sourceUrl, downloadUrl, request})
            case CLOUD_PROVIDER_NEXTCLOUD:
                return this.#fetchNextcloudJourney({sourceUrl, downloadUrl, request})
            case CLOUD_PROVIDER_ICLOUD:
                return this.#fetchICloudJourney({downloadUrl})
            default:
                return this.#fetchRemoteJourney(downloadUrl)
        }
    }

    #fetchOneDriveJourney = async ({sourceUrl, downloadUrl, request}) => {
        const sessionId = getCloudSessionId(request)
        const tokens = CLOUD_OAUTH_ENABLED ? await this.#getUsableTokens({
                                                                             sessionId,
                                                                             provider: CLOUD_PROVIDER_ONEDRIVE,
                                                                         }) : null

        if (tokens?.accessToken) {
            return this.#fetchOneDriveJourneyWithGraph({sourceUrl, accessToken: tokens.accessToken})
        }

        try {
            return await this.#fetchRemoteJourney(downloadUrl)
        }
        catch (error) {
            if (error instanceof RemoteJourneyImportError && [CLOUD_AUTH_ERROR_STATUS, 401, 403].includes(error.status)) {
                if (!CLOUD_OAUTH_ENABLED) {
                    this.#raisePrivateCloudLink(CLOUD_PROVIDER_ONEDRIVE)
                }
                this.#raiseAuthRequired(CLOUD_PROVIDER_ONEDRIVE)
            }
            throw error
        }
    }

    #ensureOAuthConfigured = (provider) => {
        if (!getClientId(provider)) {
            throw new RemoteJourneyImportError('Cloud connection is unavailable.', 501, {
                errorCode: REMOTE_IMPORT_ERROR_CODES.CLOUD_NOT_CONFIGURED,
                provider,
            })
        }
        if (provider === CLOUD_PROVIDER_NEXTCLOUD && !nextcloudBaseUrl()) {
            throw new RemoteJourneyImportError('Cloud connection is unavailable.', 501, {
                errorCode: REMOTE_IMPORT_ERROR_CODES.CLOUD_NOT_CONFIGURED,
                provider,
            })
        }
    }

    #raiseAuthRequired = (provider) => {
        this.#ensureOAuthConfigured(provider)
        throw new RemoteJourneyImportError(CLOUD_AUTH_REQUIRED_MESSAGE, 401, {
            authRequired: true,
            errorCode:    REMOTE_IMPORT_ERROR_CODES.CLOUD_AUTH_REQUIRED,
            provider,
        })
    }

    #raisePrivateCloudLink = (provider) => {
        throw new RemoteJourneyImportError(CLOUD_AUTH_ERROR_MESSAGE, CLOUD_AUTH_ERROR_STATUS, {
            errorCode: REMOTE_IMPORT_ERROR_CODES.CLOUD_PRIVATE_LINK,
            provider,
        })
    }

    #raiseAccessDenied = (provider) => {
        throw new RemoteJourneyImportError(CLOUD_ACCESS_DENIED_MESSAGE, 403, {
            errorCode: REMOTE_IMPORT_ERROR_CODES.CLOUD_ACCESS_DENIED,
            provider,
        })
    }

    #raiseCloudReadFailed = (provider) => {
        throw new RemoteJourneyImportError(CLOUD_READ_ERROR_MESSAGE, 502, {
            errorCode: REMOTE_IMPORT_ERROR_CODES.CLOUD_READ_FAILED,
            provider,
        })
    }

    #getUsableTokens = async ({sessionId, provider}) => {
        const tokens = getCloudTokens({sessionId, provider})
        if (!tokens) {
            return null
        }
        if (hasUsableAccessToken(tokens)) {
            return tokens
        }
        if (!tokens.refreshToken) {
            return null
        }

        const refreshed = await this.#refreshCloudTokens({provider, tokens})
        if (!refreshed) {
            return null
        }
        updateCloudTokens({sessionId, provider, tokens: refreshed})
        return refreshed
    }

    #refreshCloudTokens = async ({provider, tokens}) => {
        if (provider === CLOUD_PROVIDER_PCLOUD) {
            return tokens
        }

        const clientId = getClientId(provider)
        if (!clientId) {
            return null
        }

        const payload = new URLSearchParams({
                                                client_id:     clientId,
                                                refresh_token: tokens.refreshToken,
                                                grant_type:    'refresh_token',
                                            })
        const clientSecret = getClientSecret(provider)
        if (clientSecret) {
            payload.set('client_secret', clientSecret)
        }

        const tokenUrl = this.#refreshTokenUrl(provider, tokens)
        if (!tokenUrl) {
            return null
        }

        const {response, body} = await fetchJson(tokenUrl, {
            method:  'POST',
            headers: {'content-type': 'application/x-www-form-urlencoded'},
            body:    payload,
        })
        if (!response.ok) {
            return null
        }

        return toTokenPayload(body, tokens)
    }

    #refreshTokenUrl = (provider, tokens) => {
        switch (provider) {
            case CLOUD_PROVIDER_ONEDRIVE:
                return 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
            case CLOUD_PROVIDER_GOOGLE:
                return 'https://oauth2.googleapis.com/token'
            case CLOUD_PROVIDER_DROPBOX:
                return 'https://api.dropboxapi.com/oauth2/token'
            case CLOUD_PROVIDER_NEXTCLOUD:
                return nextcloudBaseUrl() ? `${nextcloudBaseUrl()}/index.php/apps/oauth2/api/v1/token` : ''
            case CLOUD_PROVIDER_PCLOUD:
                return tokens?.apiHost ? `https://${tokens.apiHost}/oauth2_token` : 'https://api.pcloud.com/oauth2_token'
            default:
                return ''
        }
    }

    #fetchOneDriveJourneyWithGraph = async ({sourceUrl, accessToken}) => {
        const shareId = `u!${toBase64Url(sourceUrl.href)}`
        const metadataUrl = `https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem`
        const {response, body} = await fetchJson(metadataUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Prefer:        GRAPH_SHARE_SCOPE,
            },
        })

        if (response.status === 401) {
            this.#raiseAuthRequired(CLOUD_PROVIDER_ONEDRIVE)
        }
        if (response.status === 403) {
            this.#raiseAccessDenied(CLOUD_PROVIDER_ONEDRIVE)
        }
        if (!response.ok) {
            this.#raiseCloudReadFailed(CLOUD_PROVIDER_ONEDRIVE)
        }

        const downloadUrl = body['@microsoft.graph.downloadUrl']
        const contentUrl = downloadUrl ?? `${metadataUrl}/content`
        const headers = downloadUrl
                        ? {}
                        : {
                Authorization: `Bearer ${accessToken}`,
                Prefer:        GRAPH_SHARE_SCOPE,
            }

        const remote = await this.#fetchRemoteJourney(new URL(contentUrl), {headers})
        return {
            ...remote,
            contentType:        remote.contentType || body.file?.mimeType || '',
            contentDisposition: remote.contentDisposition || `filename="${body.name ?? ''}"`,
        }
    }

    #fetchGoogleDriveJourney = async ({sourceUrl, downloadUrl, request}) => {
        const fileId = extractGoogleDriveFileId(sourceUrl)
        if (!fileId) {
            return this.#fetchRemoteJourney(downloadUrl)
        }

        const sessionId = getCloudSessionId(request)
        const tokens = CLOUD_OAUTH_ENABLED ? await this.#getUsableTokens({
                                                                             sessionId,
                                                                             provider: CLOUD_PROVIDER_GOOGLE,
                                                                         }) : null

        if (tokens?.accessToken) {
            return this.#fetchGoogleDriveFile({fileId, accessToken: tokens.accessToken})
        }

        try {
            return await this.#fetchRemoteJourney(downloadUrl)
        }
        catch (error) {
            if (error instanceof RemoteJourneyImportError && [CLOUD_AUTH_ERROR_STATUS, 401, 403].includes(error.status)) {
                if (!CLOUD_OAUTH_ENABLED) {
                    this.#raisePrivateCloudLink(CLOUD_PROVIDER_GOOGLE)
                }
                this.#raiseAuthRequired(CLOUD_PROVIDER_GOOGLE)
            }
            throw error
        }
    }

    #fetchGoogleDriveFile = async ({fileId, accessToken}) => {
        const metadataUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`)
        metadataUrl.searchParams.set('fields', 'id,name,mimeType,size')
        metadataUrl.searchParams.set('supportsAllDrives', 'true')
        const {response, body} = await fetchJson(metadataUrl.href, {
            headers: {Authorization: `Bearer ${accessToken}`},
        })

        if (response.status === 401) {
            this.#raiseAuthRequired(CLOUD_PROVIDER_GOOGLE)
        }
        if (response.status === 403) {
            this.#raiseAccessDenied(CLOUD_PROVIDER_GOOGLE)
        }
        if (!response.ok) {
            this.#raiseCloudReadFailed(CLOUD_PROVIDER_GOOGLE)
        }
        if (body.mimeType?.startsWith('application/vnd.google-apps.')) {
            throw new RemoteJourneyImportError('Google Workspace documents must be exported before import.', 415, {
                errorCode: REMOTE_IMPORT_ERROR_CODES.UNSUPPORTED_FORMAT,
                provider:  CLOUD_PROVIDER_GOOGLE,
            })
        }

        const contentUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`)
        contentUrl.searchParams.set('alt', 'media')
        contentUrl.searchParams.set('supportsAllDrives', 'true')
        const remote = await this.#fetchRemoteJourney(contentUrl, {
            headers: {Authorization: `Bearer ${accessToken}`},
        })

        return {
            ...remote,
            contentType:        remote.contentType || body.mimeType || '',
            contentDisposition: remote.contentDisposition || `filename="${body.name ?? ''}"`,
        }
    }

    #fetchDropboxJourney = async ({sourceUrl, downloadUrl, request}) => {
        const sessionId = getCloudSessionId(request)
        const tokens = CLOUD_OAUTH_ENABLED ? await this.#getUsableTokens({
                                                                             sessionId,
                                                                             provider: CLOUD_PROVIDER_DROPBOX,
                                                                         }) : null

        if (tokens?.accessToken && matchesDomain(sourceUrl.hostname, 'dropbox.com')) {
            return this.#fetchDropboxSharedLink({sourceUrl, accessToken: tokens.accessToken})
        }

        try {
            return await this.#fetchRemoteJourney(downloadUrl)
        }
        catch (error) {
            if (error instanceof RemoteJourneyImportError && [CLOUD_AUTH_ERROR_STATUS, 401, 403].includes(error.status)) {
                if (!CLOUD_OAUTH_ENABLED) {
                    this.#raisePrivateCloudLink(CLOUD_PROVIDER_DROPBOX)
                }
                this.#raiseAuthRequired(CLOUD_PROVIDER_DROPBOX)
            }
            throw error
        }
    }

    #fetchDropboxSharedLink = async ({sourceUrl, accessToken}) => {
        const response = await fetch('https://content.dropboxapi.com/2/sharing/get_shared_link_file', {
            method:  'POST',
            headers: {
                Authorization:     `Bearer ${accessToken}`,
                'Dropbox-API-Arg': JSON.stringify({url: sourceUrl.href}),
            },
        })

        if (response.status === 401) {
            this.#raiseAuthRequired(CLOUD_PROVIDER_DROPBOX)
        }
        if (response.status === 403) {
            this.#raiseAccessDenied(CLOUD_PROVIDER_DROPBOX)
        }
        if (!response.ok) {
            this.#raiseCloudReadFailed(CLOUD_PROVIDER_DROPBOX)
        }

        const metadata = JSON.parse(response.headers.get('dropbox-api-result') ?? '{}')
        return this.#readRemoteResponse({
                                            response,
                                            responseUrl:                sourceUrl.href,
                                            contentDispositionFallback: `filename="${metadata.name ?? ''}"`,
                                            contentTypeFallback:        metadata.file?.mimeType ?? '',
                                        })
    }

    #fetchPCloudJourney = async ({sourceUrl, downloadUrl, request}) => {
        const sessionId = getCloudSessionId(request)
        const tokens = CLOUD_OAUTH_ENABLED ? await this.#getUsableTokens({
                                                                             sessionId,
                                                                             provider: CLOUD_PROVIDER_PCLOUD,
                                                                         }) : null

        if (tokens?.accessToken) {
            const authedRemote = await this.#fetchPCloudFileLink({sourceUrl, tokens})
            if (authedRemote) {
                return authedRemote
            }
        }

        const publicRemote = await this.#fetchPCloudPublicLink(sourceUrl)
        if (publicRemote) {
            return publicRemote
        }

        try {
            return await this.#fetchRemoteJourney(downloadUrl)
        }
        catch (error) {
            if (error instanceof RemoteJourneyImportError && [CLOUD_AUTH_ERROR_STATUS, 401, 403].includes(error.status)) {
                if (!CLOUD_OAUTH_ENABLED) {
                    this.#raisePrivateCloudLink(CLOUD_PROVIDER_PCLOUD)
                }
                this.#raiseAuthRequired(CLOUD_PROVIDER_PCLOUD)
            }
            throw error
        }
    }

    #fetchPCloudPublicLink = async (sourceUrl) => {
        const code = extractPCloudCode(sourceUrl)
        if (!code) {
            return null
        }

        const apiUrl = new URL(`https://${pCloudApiHost()}/getpublinkdownload`)
        apiUrl.searchParams.set('code', code)
        apiUrl.searchParams.set('forcedownload', '1')
        const downloadUrl = await this.#resolvePCloudDownloadUrl(apiUrl)
        return this.#fetchRemoteJourney(downloadUrl)
    }

    #fetchPCloudFileLink = async ({sourceUrl, tokens}) => {
        const fileId = sourceUrl.searchParams.get('fileid')
        const path = sourceUrl.searchParams.get('path')
        if (!fileId && !path) {
            return null
        }

        const apiUrl = new URL(`https://${pCloudApiHost(tokens)}/getfilelink`)
        if (fileId) {
            apiUrl.searchParams.set('fileid', fileId)
        }
        if (path) {
            apiUrl.searchParams.set('path', path)
        }
        apiUrl.searchParams.set('forcedownload', '1')
        const downloadUrl = await this.#resolvePCloudDownloadUrl(apiUrl, tokens.accessToken)
        return this.#fetchRemoteJourney(downloadUrl)
    }

    #resolvePCloudDownloadUrl = async (apiUrl, accessToken = '') => {
        const headers = accessToken ? {Authorization: `Bearer ${accessToken}`} : {}
        const {response, body} = await fetchJson(apiUrl.href, {headers})
        if (response.status === 401) {
            if (!CLOUD_OAUTH_ENABLED) {
                this.#raisePrivateCloudLink(CLOUD_PROVIDER_PCLOUD)
            }
            this.#raiseAuthRequired(CLOUD_PROVIDER_PCLOUD)
        }
        if (response.status === 403) {
            if (!CLOUD_OAUTH_ENABLED) {
                this.#raisePrivateCloudLink(CLOUD_PROVIDER_PCLOUD)
            }
            this.#raiseAccessDenied(CLOUD_PROVIDER_PCLOUD)
        }
        if (!response.ok || body.result > 0) {
            this.#raiseCloudReadFailed(CLOUD_PROVIDER_PCLOUD)
        }

        const link = body.links?.[0] ?? body
        const host = Array.isArray(link.hosts) ? link.hosts[0] : link.host
        if (!host || !link.path) {
            this.#raiseCloudReadFailed(CLOUD_PROVIDER_PCLOUD)
        }

        return new URL(`https://${host}${link.path}`)
    }

    #fetchNextcloudJourney = async ({sourceUrl, downloadUrl, request}) => {
        const sessionId = getCloudSessionId(request)
        const tokens = CLOUD_OAUTH_ENABLED ? await this.#getUsableTokens({
                                                                             sessionId,
                                                                             provider: CLOUD_PROVIDER_NEXTCLOUD,
                                                                         }) : null

        if (tokens?.accessToken && sourceUrl.pathname.includes('/remote.php/dav/files/')) {
            return this.#fetchRemoteJourney(sourceUrl, {
                headers: {Authorization: `Bearer ${tokens.accessToken}`},
            })
        }

        try {
            return await this.#fetchRemoteJourney(downloadUrl)
        }
        catch (error) {
            if (error instanceof RemoteJourneyImportError && [CLOUD_AUTH_ERROR_STATUS, 401, 403].includes(error.status)) {
                if (!CLOUD_OAUTH_ENABLED) {
                    this.#raisePrivateCloudLink(CLOUD_PROVIDER_NEXTCLOUD)
                }
                this.#raiseAuthRequired(CLOUD_PROVIDER_NEXTCLOUD)
            }
            throw error
        }
    }

    #fetchICloudJourney = async ({downloadUrl}) => {
        try {
            return await this.#fetchRemoteJourney(downloadUrl)
        }
        catch (error) {
            if (error instanceof RemoteJourneyImportError) {
                this.#raisePrivateCloudLink(CLOUD_PROVIDER_ICLOUD)
            }
            throw error
        }
    }

    #fetchRemoteJourney = async (downloadUrl, options = {}) => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), REMOTE_JOURNEY_FETCH_TIMEOUT_MS)

        try {
            const {response, responseUrl} = await fetchWithCheckedRedirects(downloadUrl, controller.signal, options)

            if ([401, 403].includes(response.status)) {
                throw new RemoteJourneyImportError(CLOUD_AUTH_ERROR_MESSAGE, CLOUD_AUTH_ERROR_STATUS, {
                    errorCode: REMOTE_IMPORT_ERROR_CODES.CLOUD_PRIVATE_LINK,
                })
            }
            if (!response.ok) {
                throw new RemoteJourneyImportError(CLOUD_READ_ERROR_MESSAGE, 502, {
                    errorCode: REMOTE_IMPORT_ERROR_CODES.CLOUD_READ_FAILED,
                })
            }

            return await this.#readRemoteResponse({response, responseUrl})
        }
        catch (error) {
            if (error.name === 'AbortError') {
                throw new RemoteJourneyImportError('The file request timed out. Please try again later.', 504, {
                    errorCode: REMOTE_IMPORT_ERROR_CODES.REMOTE_TIMEOUT,
                })
            }
            throw error
        }
        finally {
            clearTimeout(timeoutId)
        }
    }

    #readRemoteResponse = async ({
                                     response,
                                     responseUrl,
                                     contentDispositionFallback = '',
                                     contentTypeFallback = '',
                                 }) => {
        const declaredSize = Number(response.headers.get('content-length') ?? 0)
        if (declaredSize > MAX_REMOTE_JOURNEY_BYTES) {
            throw new RemoteJourneyImportError('The file is too large to import.', 413, {
                errorCode: REMOTE_IMPORT_ERROR_CODES.REMOTE_TOO_LARGE,
            })
        }

        const buffer = await response.arrayBuffer()
        if (buffer.byteLength > MAX_REMOTE_JOURNEY_BYTES) {
            throw new RemoteJourneyImportError('The file is too large to import.', 413, {
                errorCode: REMOTE_IMPORT_ERROR_CODES.REMOTE_TOO_LARGE,
            })
        }

        const content = new TextDecoder().decode(buffer)
        if (looksLikeCloudLoginPage(content)) {
            throw new RemoteJourneyImportError(CLOUD_AUTH_ERROR_MESSAGE, CLOUD_AUTH_ERROR_STATUS, {
                errorCode: REMOTE_IMPORT_ERROR_CODES.CLOUD_PRIVATE_LINK,
            })
        }
        if (looksLikeHtmlPage(content)) {
            throw new RemoteJourneyImportError('The link returned a web page instead of an importable file.', 415, {
                errorCode: REMOTE_IMPORT_ERROR_CODES.UNSUPPORTED_FORMAT,
            })
        }

        return {
            content,
            responseUrl,
            contentType:        response.headers.get('content-type') ?? contentTypeFallback,
            contentDisposition: response.headers.get('content-disposition') ?? contentDispositionFallback,
            size:               buffer.byteLength,
        }
    }
}
