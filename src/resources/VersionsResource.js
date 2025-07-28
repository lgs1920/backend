
/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: VersionsResource.js                                                                                          *
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

import Elysia                from 'elysia'
import { VersionsController }              from '../controllers/VersionsController'
import {  VERSIONS_ROUTE } from '../index'


export class VersionsResource {

    controller = new VersionsController()

    constructor(app) {
        app.get(`${VERSIONS_ROUTE}`,
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