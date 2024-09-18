
/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 *                                                                                                                    *
 * File: PingResource.js                                                                                              *
 * Path: /home/christian/devs/assets/lgs1920/backend/src/resources/PingResource.js                                    *
 *                                                                                                                    *
 * Author : Christian Denat                                                                                           *
 * email: christian.denat@orange.fr                                                                                   *
 *                                                                                                                    *
 * Created on: 2024-09-18                                                                                             *
 * Last modified: 2024-08-14                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2024 LGS1920                                                                                           *
 *                                                                                                                    *
 **********************************************************************************************************************/

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