import cors                 from '@elysiajs/cors'
import swagger              from '@elysiajs/swagger'
import { Elysia }           from 'elysia'
import configuration        from '../config.json'


import version               from '../version.json'
import { ChangelogResource } from './resources/ChangelogResource'
import { PingResource }     from './resources/PingResource'
import { VersionsResource } from './resources/VersionsResource'

export const CHANGELOG_ROUTE = 'changelog'
export const VERSIONS_ROUTE = 'versions'
export const PING_ROUTE = 'ping'


// Declares used resources
const resources = new Map([
                              [CHANGELOG_ROUTE,new ChangelogResource()],
                              [VERSIONS_ROUTE, new VersionsResource()],
                              [PING_ROUTE, new PingResource()],
                          ])
const app = new Elysia()
    /**
     * Swagger definition
     */
    .use(swagger({
                     documentation: {
                         info:    {
                             title:   configuration.server.name,
                             version: version.api,
                         },
                         tags:    [
                             {name: 'file', description: 'file endpoints'},
                         ],
                         servers: [
                             {
                                 url:         `https://localhost:${configuration.server.port}`,
                                 description: '',
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

    .listen(configuration.server.port)

console.log(
  `LGS120 Backend (based on 🦊 Elysia) is running at ${app.server?.hostname}:${app.server?.port}`
);