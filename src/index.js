/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: index.js                                                                                                     *
 *                                                                                                                    *
 * Author : LGS1920 Team                                                                                              *
 * email: contact@lgs1920.fr                                                                                          *
 *                                                                                                                    *
 * Created on: 2025-07-28                                                                                             *
 * Last modified: 2025-07-28                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2025 LGS1920                                                                                           *
 **********************************************************************************************************************/

import cors       from '@elysiajs/cors'
import swagger    from '@elysiajs/swagger'
import { Elysia } from 'elysia'
import fs         from 'fs'

import version                  from '../version.json'
import { ChangelogResource }    from './resources/ChangelogResource'
import { ConvertVideoResource } from './resources/ConvertVideoResource'
import { PingResource }         from './resources/PingResource'
import { ReadFileResource }     from './resources/ReadFileResource'
import { VersionsResource }     from './resources/VersionsResource'

/** Route for accessing changelog */
export const CHANGELOG_ROUTE = 'changelog'
/** Route for accessing version information */
export const VERSIONS_ROUTE = 'versions'
/** Route for ping endpoint */
export const PING_ROUTE = 'ping'
/** Route for reading files */
export const READ_FILE_ROUTE = 'read'
/** Route for converting videos */
export const CONVERT_VIDEO_ROUTE = 'convert'

/** Available platform environments */
export const platforms = {
    DEV:     'development',
    STAGING: 'staging',
    PROD:    'production',
    TEST:    'test',
}

/** Server configuration loaded from servers.json */
export const configuration = JSON.parse(fs.readFileSync('servers.json', 'utf8'))
/** Build information loaded from build.json */
export const buildDate = JSON.parse(fs.readFileSync('build.json', 'utf8'))

// Set default environment variables if not provided
configuration.studio.home = configuration.studio.home || process.env.LGS1920_STUDIO_HOME
configuration.backend.home = configuration.backend.home || process.env.LGS1920_BACKEND_HOME

/** Main application instance */
const app = new Elysia()

// Common CORS headers
const corsHeaders = {
    'Access-Control-Allow-Methods':     'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type,Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age':           '3600',
}

/**
 * Middleware to handle CORS and validate origins
 * @param {Object} param - Request context
 * @param {Request} param.request - The incoming request object
 * @param {Object} param.set - Response headers setter
 * @returns {Response|undefined} Response for invalid origins or OPTIONS requests, undefined otherwise
 */
app.onBeforeHandle(({request, set}) => {
    const origin = request.headers.get('Origin')
    const url = new URL(request.url)

    // Handle Swagger requests
    if (url.pathname.startsWith('/swagger')) {
        set.headers['Access-Control-Allow-Origin'] = origin || '*'
        Object.assign(set.headers, corsHeaders)
        if (request.method === 'OPTIONS') {
            return new Response(null, {status: 204, headers: set.headers})
        }
        return
    }

    // Allow same-origin requests (null origin) if host matches backend
    const backendHost = `${configuration.backend.domain}:${configuration.backend.port}`
    const requestHost = url.host
    const isSameOrigin = !origin && requestHost === backendHost

    // Validate origin for non-Swagger requests
    const allowedOriginPattern = /^https?:\/\/([a-zA-Z0-9-]+\.)*lgs1920\.fr(?::\d+)?$/
    if (!isSameOrigin && (!origin || !allowedOriginPattern.test(origin))) {
        console.warn(`[CORS] Origin rejected: ${origin}`)
        return new Response('Forbidden origin', {status: 403})
    }

    // Set CORS headers for allowed origins
    set.headers['Access-Control-Allow-Origin'] = origin || `${url.protocol}//${url.host}`
    Object.assign(set.headers, corsHeaders)
    if (request.method === 'OPTIONS') {
        return new Response(null, {status: 204, headers: set.headers})
    }
})

/** Configure Swagger UI for API documentation */
app.use(swagger({
                    documentation: {
                        info:    {
                            title:   configuration.backend.name,
                            version: version.api,
                        },
                        tags:    [
                            {name: 'file', description: 'File-related endpoints'},
                        ],
                        servers: [
                            {
                                url:         `${configuration.backend.protocol}://${configuration.backend.domain}:${configuration.backend.port}`,
                                description: configuration.backend.name,
                            },
                        ],
                    },
                }))

/**
 * Redirect root path to Swagger UI
 * @param {Object} param - Request context
 * @param {Function} param.redirect - Redirect function
 * @returns {Response} Redirect response to /swagger
 */
app.get('/', ({redirect}) => {
    return redirect('/swagger', 302)
})

// Initialize resource routes
new PingResource(app)
new ReadFileResource(app)
new VersionsResource(app)
new ChangelogResource(app)
new ConvertVideoResource(app)

// Start the server
app.listen(configuration.backend.port)

// Log server startup information
console.log(`${configuration.backend.name} is running at ${app.server?.hostname}:${app.server?.port}`)