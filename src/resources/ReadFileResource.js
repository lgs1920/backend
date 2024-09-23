/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 *                                                                                                                    *
 * File: ReadFileResource.js                                                                                          *
 * Path: /home/christian/devs/assets/lgs1920/backend/src/resources/ReadFileResource.js                                *
 *                                                                                                                    *
 * Author : Christian Denat                                                                                           *
 * email: christian.denat@orange.fr                                                                                   *
 *                                                                                                                    *
 * Created on: 2024-09-23                                                                                             *
 * Last modified: 2024-09-23                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2024 LGS1920                                                                                           *
 *                                                                                                                    *
 **********************************************************************************************************************/

import Elysia                 from 'elysia'
import { ReadFileController } from '../controllers/ReadFileController'


export class ReadFileResource {

    controller = new ReadFileController()

    constructor() {
        this.resource = new Elysia({})
            .get('/read', this.controller.readFile, {

                     detail: {
                         query:       {
                             file: {
                                 type:        'string',
                                 description: 'Full path to the file',
                                 required:    true,
                             },
                         },
                         tags:        this.tags,
                         description: 'API Read File',
                         responses:   {
                             200: {
                                 description: 'The file content you requested',
                             },
                             500: {
                                 description: 'Internal error',
                             },
                         },
                     },
                 },
            )
    }
}