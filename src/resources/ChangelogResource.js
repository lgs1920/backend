/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: ChangelogResource.js                                                                                         *
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

import { ChangelogController } from '../controllers/ChangelogController'
import { CHANGELOG_ROUTE }     from '../index'


export class ChangelogResource {

    controller = new ChangelogController()

    constructor(app) {
        app.group(`/${CHANGELOG_ROUTE}`, (group) =>
            group.get('/list',
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
                     }),
        )
    }
}