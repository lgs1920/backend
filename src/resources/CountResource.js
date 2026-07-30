import { CountController } from '../controllers/CountController.js'
import { CountStore }      from '../services/CountStore.js'

export const COUNT_ROUTE = '/count'

const COUNT_ITEM_PARAMETER = {
    name:        'item',
    in:          'path',
    required:    true,
    description: 'Aggregate item to read. `total` returns the complete counter row; `videos` returns separate `draft` and `hq` values.',
    schema:      {
        type:   'string',
        enum:   ['total', 'visits', 'journeys', 'videos'],
        example: 'visits',
    },
}

const COUNT_PERIOD_PARAMETER = {
    name:        'period',
    in:          'path',
    required:    true,
    description: 'Period type for the item lookup. For current daily, weekly, monthly, and yearly values, the requested client time zone is used.',
    schema:      {
        type:   'string',
        enum:   ['total', 'daily', 'weekly', 'monthly', 'yearly'],
        example: 'daily',
    },
}

const COUNT_DATE_PARAMETER = {
    name:        'date',
    in:          'path',
    required:    true,
    description: 'Calendar date in `dd-mm-yyyy` format for the requested count time zone.',
    schema:      {
        type:    'string',
        pattern: '^\\d{2}-\\d{2}-\\d{4}$',
        example: '29-07-2026',
    },
}

const COUNT_WEEK_PARAMETER = {
    name:        'week',
    in:          'path',
    required:    true,
    description: 'ISO week in `yyyy-Www` format for the requested count time zone.',
    schema:      {
        type:    'string',
        pattern: '^\\d{4}-W(?:0[1-9]|[1-4]\\d|5[0-3])$',
        example: '2026-W31',
    },
}

const COUNT_MONTH_PARAMETER = {
    name:        'month',
    in:          'path',
    required:    true,
    description: 'Calendar month in `mm-yy` format for the requested count time zone.',
    schema:      {
        type:    'string',
        pattern: '^(?:0[1-9]|1[0-2])-\\d{2}$',
        example: '07-26',
    },
}

const COUNT_YEAR_PARAMETER = {
    name:        'year',
    in:          'path',
    required:    true,
    description: 'Calendar year in `yyyy` format for the requested count time zone.',
    schema:      {
        type:    'string',
        pattern: '^\\d{4}$',
        example: '2026',
    },
}

const COUNT_TIME_ZONE_PARAMETER = {
    name:        'timeZone',
    in:          'query',
    required:    false,
    description: 'IANA time zone used for the current calendar period. Defaults to UTC when omitted.',
    schema:      {
        type:      'string',
        maxLength: 64,
        example:   'America/Montreal',
    },
}

/**
 * Register the aggregate count API on an Elysia application.
 */
export class CountResource {
    /**
     * Register count event and read routes.
     *
     * @param {object} app Elysia application instance.
     * @param {object} options Resource configuration.
     * @param {CountStore} [options.store] Injected store for tests or composition.
     * @param {string} [options.backendHome] Backend home used by the default store.
     * @param {boolean} [options.registerShutdownHandlers=false] Save on controlled shutdown.
     */
    constructor(app, {
                    store = null,
                    backendHome = undefined,
                    registerShutdownHandlers = false,
                } = {}) {
        if (!app) {
            throw new Error('app is undefined')
        }

        this.store = store ?? new CountStore({
            backendHome,
            registerShutdownHandlers,
        })
        this.controller = new CountController(this.store)

        app.post(`${COUNT_ROUTE}/visit`, this.controller.visit, this.eventDetail('Count a visit'))
        app.post(`${COUNT_ROUTE}/journey`, this.controller.journey, this.eventDetail('Count a journey load'))
        app.post(`${COUNT_ROUTE}/video/draft`, this.controller.videoDraft, this.eventDetail('Count a draft video'))
        app.post(`${COUNT_ROUTE}/video/hq`, this.controller.videoHq, this.eventDetail('Count a high-quality video'))

        app.get(COUNT_ROUTE, this.controller.getSnapshot, this.readDetail('Read the complete count snapshot'))
        app.get(`${COUNT_ROUTE}/:item`, this.controller.getItem, this.readDetail('Read a lifetime count item', [COUNT_ITEM_PARAMETER]))
        app.get(`${COUNT_ROUTE}/:item/:period`, this.controller.getItemPeriod, this.readDetail('Read a count item for a period', [COUNT_ITEM_PARAMETER, COUNT_PERIOD_PARAMETER]))

        app.get(`${COUNT_ROUTE}/daily`, this.controller.getDaily, this.readDetail('Read the current client-time-zone daily count'))
        app.get(`${COUNT_ROUTE}/daily/:date`, this.controller.getDailyAt, this.readDetail('Read a daily count', [COUNT_DATE_PARAMETER]))
        app.get(`${COUNT_ROUTE}/weekly`, this.controller.getWeekly, this.readDetail('Read the current client-time-zone weekly count'))
        app.get(`${COUNT_ROUTE}/weekly/:week`, this.controller.getWeeklyAt, this.readDetail('Read a weekly count', [COUNT_WEEK_PARAMETER]))
        app.get(`${COUNT_ROUTE}/monthly`, this.controller.getMonthly, this.readDetail('Read the current client-time-zone monthly count'))
        app.get(`${COUNT_ROUTE}/monthly/:month`, this.controller.getMonthlyAt, this.readDetail('Read a monthly count', [COUNT_MONTH_PARAMETER]))
        app.get(`${COUNT_ROUTE}/yearly`, this.controller.getYearly, this.readDetail('Read the current client-time-zone yearly count'))
        app.get(`${COUNT_ROUTE}/yearly/:year`, this.controller.getYearlyAt, this.readDetail('Read a yearly count', [COUNT_YEAR_PARAMETER]))
    }

    /**
     * Build OpenAPI metadata for an event route.
     *
     * @param {string} description Route description.
     * @returns {object} Elysia route metadata.
     */
    eventDetail = (description) => ({
        detail: {
            tags:        ['count'],
            description,
            body:        {
                type:       'object',
                properties: {
                    timeZone: {
                        type:      'string',
                        maxLength: 64,
                        example:   'America/Montreal',
                    },
                },
                additionalProperties: false,
            },
            produces:    ['application/json'],
            responses:   {
                200: {description: 'Count event accepted'},
                500: {description: 'Unable to record count event'},
            },
        },
    })

    /**
     * Build OpenAPI metadata for a read route.
     *
     * @param {string} description Route description.
     * @param {object[]} [parameters] OpenAPI path parameters.
     * @returns {object} Elysia route metadata.
     */
    readDetail = (description, parameters = []) => ({
        detail: {
            tags:        ['count'],
            description,
            parameters: [...parameters, COUNT_TIME_ZONE_PARAMETER],
            produces:    ['application/json'],
            responses:   {
                200: {description: 'Count data returned'},
                400: {description: 'Invalid count path parameter'},
                500: {description: 'Unable to read count data'},
            },
        },
    })
}
