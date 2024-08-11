import Elysia             from 'elysia'
import { PingController } from '../controllers/PingController'
import { PING_ROUTE }     from '../index'


export class PingResource {

    controller = new PingController()

    constructor() {
        this.resource = new Elysia({})
            .get(`${PING_ROUTE}`,
                 this.controller.ping,
                 {
                     detail: {
                         tags:        this.tags,
                         description: 'API Ping',
                         produces:    ['application/json'],
                         responses:   {
                             200: {
                                 description: 'The Ping you requested',
                             },
                             500: {
                                 description: 'Internal error',
                             },
                         },
                     },
                 })
    }
}