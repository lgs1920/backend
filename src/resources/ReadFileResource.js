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

    /**
     * Register the internal file-reading route.
     *
     * @param {object} app Elysia application instance.
     * @param {object} options Route security options.
     * @param {Function} [options.beforeHandle] Internal access guard.
     */
    constructor(app, {beforeHandle = undefined} = {}) {
        app.get('/read', this.controller.readFile, {
                     beforeHandle,

                     detail: {
                         query:       {
                             file: {
                                 type:        'string',
                                 description: 'Relative path to a file below the selected application root. Remote URLs and traversal are rejected.',
                                 required:    true,
                             },
                             path: {
                                 type:        'string',
                                 enum:        ['backend', 'studio'],
                                 description: 'Application root. Defaults to studio.',
                                 required:    false,
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
