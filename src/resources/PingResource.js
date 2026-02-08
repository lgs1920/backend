/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: PingResource.js                                                                                              *
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

import { PingController } from '../controllers/PingController'
import { PING_ROUTE }     from '../index'


export class PingResource {

    controller = new PingController()

    constructor(app) {
        if (!app) {
            console.error('Erreur : app est undefined dans PingResource')
            throw new Error('app is undefined')
        }
        app.get(`${PING_ROUTE}`,
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