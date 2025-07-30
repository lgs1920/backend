/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: index.js                                                                                                     *
 *                                                                                                                    *
 * Author : LGS1920 Team                                                                                              *
 * email: contact@lgs1920.fr                                                                                          *
 *                                                                                                                    *
 * Created on: 2025-07-30                                                                                             *
 * Last modified: 2025-07-30                                                                                          *
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


const yellow = '\x1b[33m'
const green = '\x1b[32m'
const reset = '\x1b[0m'

/** Main application instance */

const app = new Elysia()
    .use(
        cors({
                 preflight: true,
                 origin:    /^https?:\/\/([a-zA-Z0-9-]+\.)*lgs1920\.fr(?::\d+)?$/,
             }),
    )

// /** Configure Swagger UI for API documentation */
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
console.log(`${green}${configuration.backend.name}${reset} is running at ${yellow}${configuration.backend.domain}:${app.server?.port}${reset}.`)
