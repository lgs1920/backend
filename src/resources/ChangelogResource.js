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
                 })
    }
}