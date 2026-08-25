
/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 *                                                                                                                    *
 * File: PingController.js                                                                                            *
 * Path: /home/christian/devs/assets/lgs1920/backend/src/controllers/PingController.js                                *
 *                                                                                                                    *
 * Author : Christian Denat                                                                                           *
 * email: christian.denat@orange.fr                                                                                   *
 *                                                                                                                    *
 * Created on: 2024-10-14                                                                                             *
 * Last modified: 2024-10-14                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2024 LGS1920                                                                                           *
 *                                                                                                                    *
 **********************************************************************************************************************/

import { Controller }               from './Controller'
import { buildDate, configuration } from '../index'
import { DateTime } from 'luxon'
export class PingController extends Controller{

    /**
     * @param {object} [options] Controller options.
     * @param {Function} [options.isDraining=() => false] Liveness drain-state reader.
     */
    constructor({isDraining = () => false} = {}) {
        super()
        this.isDraining = isDraining
    }

    /**
     * Return the lightweight backend liveness response.
     *
     * @param {object} context Request context.
     * @param {object} context.set Response status state.
     * @returns {Promise<object>} Liveness response.
     */
    ping = async ({set}) => {
        if (this.isDraining()) {
            set.status = 503
            return {alive: false, reason: 'shutting-down'}
        }

        const timestamp = buildDate.date ?? Date.now()
        const date = `${DateTime.fromMillis(timestamp).toLocaleString(DateTime.DATETIME_FULL_WITH_SECONDS)}`
        return {alive: true, platform: configuration.platform, build: date, timestamp: timestamp}
    }

}
