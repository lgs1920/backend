
/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: ConvertVideoResource.js                                                                                      *
 *                                                                                                                    *
 * Author : LGS1920 Team                                                                                              *
 * email: contact@lgs1920.fr                                                                                          *
 *                                                                                                                    *
 * Created on: 2025-08-01                                                                                             *
 * Last modified: 2025-08-01                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2025 LGS1920                                                                                           *
 **********************************************************************************************************************/

import { ConvertVideoController } from '../controllers/ConvertVideoController'
import { CONVERT_VIDEO_ROUTE } from '../index'


export class ConvertVideoResource {

    controller = new ConvertVideoController()

    constructor(app) {
        app.group(CONVERT_VIDEO_ROUTE, (group) =>
            group
                .post('', this.controller.convertVideo.bind(this.controller))
                .get('/progress/:id', this.controller.startProgressStream.bind(this.controller)),
        )
    }
}