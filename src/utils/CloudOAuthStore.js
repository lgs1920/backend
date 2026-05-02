/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: CloudOAuthStore.js                                                                                           *
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

import { createHash, randomBytes } from 'node:crypto'

export const CLOUD_SESSION_COOKIE = 'lgs_cloud_session'
export const CLOUD_PROVIDER_ONEDRIVE = 'onedrive'
export const CLOUD_PROVIDER_GOOGLE = 'google'
export const CLOUD_PROVIDER_DROPBOX = 'dropbox'
export const CLOUD_PROVIDER_PCLOUD = 'pcloud'
export const CLOUD_PROVIDER_NEXTCLOUD = 'nextcloud'
export const CLOUD_PROVIDER_ICLOUD = 'icloud'

const STATE_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TOKEN_EXPIRY_SKEW_MS = 60 * 1000

const pendingStates = new Map()
const sessions = new Map()

const now = () => Date.now()

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

export const pkceChallenge = (verifier) => {
    return createHash('sha256').update(verifier).digest('base64url')
}

const cleanupPendingStates = () => {
    const threshold = now() - STATE_TTL_MS
    for (const [state, value] of pendingStates.entries()) {
        if (value.createdAt < threshold) {
            pendingStates.delete(state)
        }
    }
}

const cleanupSessions = () => {
    const threshold = now() - SESSION_TTL_MS
    for (const [sessionId, value] of sessions.entries()) {
        if (value.updatedAt < threshold) {
            sessions.delete(sessionId)
        }
    }
}

export const createOAuthState = ({provider, returnUrl, codeVerifier}) => {
    cleanupPendingStates()
    const state = randomToken()
    pendingStates.set(state, {
        provider,
        returnUrl,
        codeVerifier,
        createdAt: now(),
    })

    return state
}

export const consumeOAuthState = (state) => {
    cleanupPendingStates()
    const value = pendingStates.get(state)
    pendingStates.delete(state)
    return value
}

export const getCookieValue = (request, name) => {
    const cookieHeader = request?.headers?.get('cookie') ?? ''
    const cookies = cookieHeader.split(';').map(cookie => cookie.trim())

    for (const cookie of cookies) {
        const [key, ...value] = cookie.split('=')
        if (key === name) {
            return decodeURIComponent(value.join('=') ?? '')
        }
    }

    return ''
}

export const getCloudSessionId = (request) => getCookieValue(request, CLOUD_SESSION_COOKIE)

export const setCloudTokens = ({sessionId = randomToken(), provider, tokens}) => {
    cleanupSessions()
    const session = sessions.get(sessionId) ?? {providers: new Map()}
    session.providers.set(provider, {
        ...tokens,
        updatedAt: now(),
    })
    session.updatedAt = now()
    sessions.set(sessionId, session)

    return sessionId
}

export const getCloudTokens = ({sessionId, provider}) => {
    cleanupSessions()
    const tokens = sessions.get(sessionId)?.providers?.get(provider)
    if (!tokens) {
        return null
    }

    return tokens
}

export const updateCloudTokens = ({sessionId, provider, tokens}) => {
    if (!sessionId) {
        return ''
    }

    return setCloudTokens({sessionId, provider, tokens})
}

export const hasUsableAccessToken = (tokens) => {
    return Boolean(tokens?.accessToken) && (!tokens.expiresAt || tokens.expiresAt - TOKEN_EXPIRY_SKEW_MS > now())
}

export const connectedProviders = (sessionId) => {
    cleanupSessions()
    const session = sessions.get(sessionId)
    if (!session) {
        return []
    }

    return Array.from(session.providers.keys())
}

export const deleteCloudSession = (sessionId) => {
    if (sessionId) {
        sessions.delete(sessionId)
    }
}
