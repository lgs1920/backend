/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: ConvertVideoResource.js                                                                                      *
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

import { Elysia, t }              from 'elysia'
import { ConvertVideoController } from '../controllers/ConvertVideoController'


export class ConvertVideoResource {

    controller = new ConvertVideoController()

    constructor() {
        this.resource = new Elysia()
            .post('/convert', this.controller.convert, {
                body:  t.Object({
                                    from:   t.String(),
                                    to:     t.String(),
                                    params: t.Optional(t.Array(t.String())),
                                }),
                files: t.Object({
                                    file: t.File(),
                                }),
            })

            .get('/convert/progress/:id', this.controller.progress)
    }
}