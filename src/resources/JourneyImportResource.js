/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: JourneyImportResource.js                                                                                     *
 *                                                                                                                    *
 * Author : LGS1920 Team                                                                                              *
 * email: contact@lgs1920.fr                                                                                          *
 *                                                                                                                    *
 * Created on: 2026-05-02                                                                                             *
 * Last modified: 2026-05-02                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2026 LGS1920                                                                                           *
 **********************************************************************************************************************/

import { JourneyImportController } from '../controllers/JourneyImportController.js'
import { JOURNEY_ROUTE }           from '../index.js'

export class JourneyImportResource {

    controller = new JourneyImportController()

    constructor(app) {
        app.group(`/${JOURNEY_ROUTE}`, (group) =>
            group.post('/import-url',
                       this.controller.importFromUrl,
                       {
                           detail: {
                               tags:        this.tags,
                               description: 'Import a journey file from a public remote URL or public cloud share link. Authenticated cloud connections are not yet available.',
                               produces:    ['application/json'],
                               responses:   {
                                   200: {
                                       description: 'The imported journey file content and metadata, or a controlled import failure with success=false',
                                   },
                                   500: {
                                       description: 'Unexpected backend error',
                                   },
                               },
                           },
                       }),
        )
    }
}
