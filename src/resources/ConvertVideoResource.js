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

import { t }                   from 'elysia'
import { ConvertVideoController } from '../controllers/ConvertVideoController'
import { CONVERT_VIDEO_ROUTE } from '../index'


export class ConvertVideoResource {

    controller = new ConvertVideoController()

    constructor(app) {
        app.group(CONVERT_VIDEO_ROUTE, (group) =>
            group
                .post('', this.controller.convert, {
                    body:  t.Object({
                                        from:   t.String(),
                                        to:     t.String(),
                                        params: t.Optional(t.Array(t.String())),
                                    }),
                    files: t.Object({
                                        file: t.File(),
                                    }),
                })
                .get('/progress/:id', this.controller.progress),
        )
    }
}