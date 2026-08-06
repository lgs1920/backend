/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: index.js                                                                                                     *
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

import cors       from '@elysiajs/cors'
import swagger    from '@elysiajs/swagger'
import { Elysia } from 'elysia'
import fs         from 'fs'
import version                  from '../version.json'
import { ChangelogResource }    from './resources/ChangelogResource'
import { CloudAuthResource }     from './resources/CloudAuthResource.js'
import { ConvertVideoResource } from './resources/ConvertVideoResource'
import { LaunchRegistrationResource } from './resources/LaunchRegistrationResource.js'
import { ContactMailResource }   from './resources/ContactMailResource.js'
import { CountResource }         from './resources/CountResource.js'
import { JourneyImportResource } from './resources/JourneyImportResource.js'
import { PingResource }         from './resources/PingResource'
import { ReadFileResource }     from './resources/ReadFileResource'
import { VersionsResource }     from './resources/VersionsResource'
import {
    createInternalApiGuard,
    createSecurityHeadersHook,
    getAllowedOrigins,
} from './utils/BackendSecurity.js'
import { resolveBackendHost } from './utils/BackendServerConfig.js'

/** Route for accessing changelog */
export const CHANGELOG_ROUTE = 'changelog'
/** Route for accessing version information */
export const VERSIONS_ROUTE = 'versions'
/** Route for ping endpoint */
export const PING_ROUTE = 'ping'
/** Route for reading files */
export const READ_FILE_ROUTE = 'read'
/** Route for converting videos */
export const CONVERT_VIDEO_ROUTE = {
    convert:  'convert',
    progress: '/progress',
    download: '/download',
    cancel:   '/cancel',
}
/** Route for journey imports */
export const JOURNEY_ROUTE = 'journey'
/** Route for cloud OAuth authentication */
export const CLOUD_AUTH_ROUTE = 'cloud-auth'

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
configuration.backend.home = configuration.backend.home || process.env.LGS1920_BACKEND_HOME || process.cwd()


const yellow = '\x1b[33m'
const green = '\x1b[32m'
const orange = '\x1b[38;5;208m'
const reset = '\x1b[0m'

const startupTime = new Intl.DateTimeFormat('en-GB', {
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
}).format(new Date())

const isReloadRuntime = () => process.execArgv.includes('--watch') || process.execArgv.includes('--hot')

const isHotStartup = () => {
    if (!isReloadRuntime()) {
        return false
    }

    const startupStateKey = Symbol.for('lgs1920.backend.startup.seen')
    if (globalThis[startupStateKey]) {
        return true
    }

    globalThis[startupStateKey] = true

    const safeWorkingDirectory = process.cwd().replace(/[^a-zA-Z0-9.-]+/g, '_')
    const startupMarkerPath = `${process.env.TMPDIR || '/tmp'}/lgs1920-backend-${safeWorkingDirectory}-${process.ppid}.startup`
    const wasAlreadyStarted = fs.existsSync(startupMarkerPath)

    try {
        fs.writeFileSync(startupMarkerPath, `${process.pid}:${Date.now()}`)
    }
    catch {
        return false
    }

    return wasAlreadyStarted
}

/** Main application instance */
const deploymentPlatform = configuration.platform ?? platforms.PROD
const isDevelopment = deploymentPlatform === platforms.DEV || process.env.NODE_ENV === 'development'
const allowedOrigins = getAllowedOrigins(deploymentPlatform)
const publicHttps = process.env.LGS1920_PUBLIC_HTTPS === 'true'
const internalApiGuard = createInternalApiGuard({allowWithoutToken: isDevelopment})
const backendHost = resolveBackendHost({
    environmentHost: process.env.LGS1920_BACKEND_HOST,
    configuredHost:  configuration.backend.host,
})

const app = new Elysia() //
    .use(
        cors({
                 preflight: true,
                 origin: allowedOrigins,

                 methods: ['GET', 'POST', 'DELETE'],
                 allowedHeaders: ['Accept', 'Authorization', 'Content-Type', 'X-Conversion-Id', 'X-Request-Progress', 'X-Progress-Interval'],
                 exposedHeaders: ['X-Conversion-Id'],
                 credentials:    true,
             }),
    )
    .onAfterHandle(createSecurityHeadersHook({publicHttps}))

// /** Configure Swagger UI for API documentation */
app.use(swagger({
                    documentation: {
                        info:    {
                            title:   configuration.backend.name,
                            version: version.api,
                        },
                        tags:    [
                            {name: 'file', description: 'File-related endpoints'},
                            {name: 'count', description: 'Real-time aggregate counters and client-time-zone period history'},
                            {name: 'launch-registration', description: 'Public Studio launch registrations'},
                            {name: 'contact', description: 'Public contact messages sent by email'},
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
new ReadFileResource(app, {beforeHandle: internalApiGuard})
new VersionsResource(app)
new ChangelogResource(app)
new ConvertVideoResource(app, {beforeHandle: internalApiGuard})
new CloudAuthResource(app)
new JourneyImportResource(app)
new LaunchRegistrationResource(app, {
    backendHome: configuration.backend.home,
})
new ContactMailResource(app)
new CountResource(app, {
    backendHome:              configuration.backend.home,
    registerShutdownHandlers: true,
})

// Start the server
app.listen({hostname: backendHost, port: configuration.backend.port})

// Log server startup information
const startupStatus = isHotStartup() ? `${orange}[hot reload]${reset}` : `${yellow}[start]${reset}`
console.log(`${green}[${startupTime}]${reset} ${startupStatus} ${green}${configuration.backend.name}${yellow}[${version.backend}]${reset} is running at ${yellow}${configuration.backend.domain}:${app.server?.port}${reset}.`)
