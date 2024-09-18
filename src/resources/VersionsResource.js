
/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 *                                                                                                                    *
 * File: VersionsResource.js                                                                                          *
 * Path: /home/christian/devs/assets/lgs1920/backend/src/resources/VersionsResource.js                                *
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