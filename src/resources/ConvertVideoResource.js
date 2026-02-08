/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: ConvertVideoResource.js                                                                                      *
 *                                                                                                                    *
 * Author : LGS1920 Team                                                                                              *
 * email: contact@lgs1920.fr                                                                                          *
 *                                                                                                                    *
 * Created on: 2025-08-05                                                                                             *
 * Last modified: 2025-08-05                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2025 LGS1920                                                                                           *
 **********************************************************************************************************************/

import { ConvertVideoController } from '../controllers/ConvertVideoController'
import { CONVERT_VIDEO_ROUTE } from '../index'


export class ConvertVideoResource {

    controller = new ConvertVideoController()

    constructor(app) {
        app.group(CONVERT_VIDEO_ROUTE.convert, (group) =>
            group
                .post('', this.controller.convertVideo.bind(this.controller))
                .get(`${CONVERT_VIDEO_ROUTE.progress}/:id`, this.controller.startProgressStream.bind(this.controller))
                .get(`${CONVERT_VIDEO_ROUTE.download}/:id`, this.controller.downloadConvertedFile.bind(this.controller))
                .delete(`${CONVERT_VIDEO_ROUTE.cancel}/:id`, this.controller.cancelConversion.bind(this.controller)), // ✅
                                                                                                                      // Utiliser
                                                                                                                      // la
                                                                                                                      // constante
        )
    }
}