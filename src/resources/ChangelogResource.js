import Elysia                  from 'elysia'
import { ChangelogController } from '../controllers/ChangelogController'
import { CHANGELOG_ROUTE }     from '../index'


export class ChangelogResource {

    controller = new ChangelogController()

    constructor() {
        this.resource = new Elysia({prefix: `/${CHANGELOG_ROUTE}`})
            .get('/list',
                 this.controller.list,
                 {
                     detail: {
                         tags:        this.tags,
                         description: 'Get changelog file listing',
                         produces:    ['application/json'],
                        // consumes:    ['application/json'],
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
    }
}