import cors             from '@elysiajs/cors'
import swagger          from '@elysiajs/swagger'
import { Elysia }       from 'elysia'
import configuration    from '../config.json'
import version               from '../version.json'
import { ChangelogResource } from './resources/ChangelogResource'

export const CHANGELOG_ROUTE = 'changelog'
export const BACKEND='../backend/'
export const STUDIO = '../studio/'

// Declares used resources
const resources = new Map([
                              [CHANGELOG_ROUTE,new ChangelogResource()]
                          ])
const app = new Elysia()
    /**
     * Swagger definition
     */
    .use(swagger({
                     documentation: {
                         info:    {
                             title:   configuration.server.name,
                             version: version.backend,
                         },
                         tags:    [
                             {name: 'file', description: 'file endpoints'},
                         ],
                         servers: [
                             {
                                 url:         `http://localhost:${configuration.server.port}`,
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

    /**
     * Changelog Routes
     */
    .use(resources.get(CHANGELOG_ROUTE).resource)

    .use(cors({origin: 'localhost:5173'}))
    .listen(configuration.server.port)




console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
