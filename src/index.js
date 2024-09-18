
/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 *                                                                                                                    *
 * File: index.js                                                                                                     *
 * Path: /home/christian/devs/assets/lgs1920/backend/src/index.js                                                     *
 *                                                                                                                    *
 * Author : Christian Denat                                                                                           *
 * email: christian.denat@orange.fr                                                                                   *
 *                                                                                                                    *
 * Created on: 2024-09-18                                                                                             *
 * Last modified: 2024-09-18                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2024 LGS1920                                                                                           *
 *                                                                                                                    *
 **********************************************************************************************************************/

import cors                 from '@elysiajs/cors'
import swagger              from '@elysiajs/swagger'
import { Elysia }           from 'elysia'

import version               from '../version.json'
import { ChangelogResource } from './resources/ChangelogResource'
import { PingResource }     from './resources/PingResource'
import { VersionsResource } from './resources/VersionsResource'

export const CHANGELOG_ROUTE = 'changelog'
export const VERSIONS_ROUTE = 'versions'
export const PING_ROUTE = 'ping'

export const platforms = {
    DEV:'development',
    STAGING:'staging',
    PROD:'production',
    TEST:'test'
}

// Declares used resources
const resources = new Map([
                              [CHANGELOG_ROUTE,new ChangelogResource()],
                              [VERSIONS_ROUTE, new VersionsResource()],
                              [PING_ROUTE, new PingResource()],
                          ])

// Get platform type and name
var platform= {
    type:process.env.PLATFORM_TYPE,
    name:process.env.PLATFORM_NAME
}

// Launch backend app
const app = new Elysia()
    /**
     * Swagger definition
     */
    .use(swagger({
                     documentation: {
                         info:    {
                             title:   process.env.BACKEND_NAME,
                             version: version.api,
                         },
                         tags:    [
                             {name: 'file', description: 'file endpoints'},
                         ],
                         servers: [
                             {
                                 url:         `${process.env.BACKEND_PROTOCOL}://localhost:${process.env.BACKEND_PORT}`,
                                 description: process.env.BACKEND_NAME,
                             },
                         ],
                     },
                 }))

    // TODO filter

    // Without any path, we redirect / to /swagger
    .get('/', ({set}) => {
        set.redirect = '/swagger'
    })

    // Routes
    .use(resources.get(CHANGELOG_ROUTE).resource)
    .use(resources.get(VERSIONS_ROUTE).resource)
    .use(resources.get(PING_ROUTE).resource)

    //.use(cors({origin: /^http(s)?:\/\/(?:localhost|localhost:5173|localhost:4173|studio\.lgs1920.fr)(?::\d+)?\/?$/}))
    .use(cors({origin: true}))

    .listen(process.env.BACKEND_PORT)

console.log(
  `${process.env.BACKEND_NAME} is running at ${app.server?.hostname}:${app.server?.port}`
);