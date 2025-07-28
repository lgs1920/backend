/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: ReadFileResource.js                                                                                          *
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

import Elysia                 from 'elysia'
import { ReadFileController } from '../controllers/ReadFileController'


export class ReadFileResource {

    controller = new ReadFileController()

    constructor(app) {
        app.get('/read', this.controller.readFile, {

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