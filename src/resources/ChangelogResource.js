
/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 *                                                                                                                    *
 * File: ChangelogResource.js                                                                                         *
 * Path: /home/christian/devs/assets/lgs1920/backend/src/resources/ChangelogResource.js                               *
 *                                                                                                                    *
 * Author : Christian Denat                                                                                           *
 * email: christian.denat@orange.fr                                                                                   *
 *                                                                                                                    *
 * Created on: 2024-09-18                                                                                             *
 * Last modified: 2024-08-31                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2024 LGS1920                                                                                           *
 *                                                                                                                    *
 **********************************************************************************************************************/

import Elysia                  from 'elysia'
import { ChangelogController } from '../controllers/ChangelogController'
import { CHANGELOG_ROUTE }     from '../index'


export class ChangelogResource {

    controller = new ChangelogController()

    constructor() {
        this.resource = new Elysia({prefix: `/${CHANGELOG_ROUTE}`})
            .get('/list',
                 this.controller.list,
                 {
                     detail: {
                         tags:        this.tags,
                         description: 'Get changelog file listing',
                         produces:    ['application/json'],
                         responses:   {
                             200: {
                                 description: 'The listing you requested',
                             },
                             500: {
                                 description: 'Internal error',
                             },
                         },
                     },
                 })
            .get('/read/:file',
                 this.controller.read,
                 {
                     detail: {
                         tags:        this.tags,
                         description: 'Read changelog file',
                         produces:    ['application/json'],
                         responses:   {
                             200: {
                                 description: 'The file content you requested',
                             },
                             500: {
                                 description: 'Internal error',
                             },
                         },
                     },
                 })
    }
}