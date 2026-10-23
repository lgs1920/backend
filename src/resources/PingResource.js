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

    controller

    /**
     * Register the backend liveness endpoint.
     *
     * @param {object} app Elysia application instance.
     * @param {object} [options] Resource options.
     * @param {Function} [options.isDraining=() => false] Liveness drain-state reader.
     */
    constructor(app, {isDraining = () => false} = {}) {
        if (!app) {
            console.error('Erreur : app est undefined dans PingResource')
            throw new Error('app is undefined')
        }

        this.controller = new PingController({isDraining})
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
                            503: {
                                description: 'Backend is draining for a controlled shutdown',
                            },
                        },
                    },
                })
    }
}
