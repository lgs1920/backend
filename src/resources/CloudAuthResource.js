/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: CloudAuthResource.js                                                                                         *
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

import { CloudAuthController } from '../controllers/CloudAuthController.js'
import { CLOUD_AUTH_ROUTE }    from '../index.js'

export class CloudAuthResource {

    controller = new CloudAuthController()
    tags = ['cloud-auth']

    constructor(app) {
        app.group(`/${CLOUD_AUTH_ROUTE}`, (group) =>
            group.get('/status',
                      this.controller.status,
                      {
                          detail: {
                              tags:        this.tags,
                              description: 'Cloud OAuth status. Account connection is not yet available.',
                          },
                      })
                .get('/:provider/start',
                     this.controller.start,
                     {
                         detail: {
                             tags:        this.tags,
                             description: 'Start cloud OAuth connection. Not yet available.',
                             responses:   {
                                 501: {
                                     description: 'Cloud account connection is not available yet',
                                 },
                             },
                         },
                     })
                .get('/:provider/callback',
                     this.controller.callback,
                     {
                         detail: {
                             tags:        this.tags,
                             description: 'Cloud OAuth callback. Not yet available.',
                         },
                     })
                .delete('/logout',
                        this.controller.logout,
                        {
                            detail: {
                                tags:        this.tags,
                                description: 'Clear cloud OAuth session. Account connection is not yet available.',
                            },
                        }),
        )
    }
}
