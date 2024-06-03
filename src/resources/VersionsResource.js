import Elysia                from 'elysia'
import { VersionsController }              from '../controllers/VersionsController'
import {  VERSIONS_ROUTE } from '../index'


export class VersionsResource {

    controller = new VersionsController()

    constructor() {
        this.resource = new Elysia({})
            .get(`${VERSIONS_ROUTE}`,
                 this.controller.versions,
                 {
                     detail: {
                         tags:        this.tags,
                         description: 'Get Backend and API Versions',
                         produces:    ['application/json'],
                         responses:   {
                             200: {
                                 description: 'The versions you requested',
                             },
                             500: {
                                 description: 'Internal error',
                             },
                         },
                     },
                 })
    }
}