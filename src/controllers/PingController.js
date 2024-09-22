
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
 * Created on: 2024-09-21                                                                                             *
 * Last modified: 2024-09-21                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2024 LGS1920                                                                                           *
 *                                                                                                                    *
 **********************************************************************************************************************/

import { Controller }  from './Controller'
import { configuration } from '../index'
export class PingController extends Controller{

    /**
     * Read all versions and return them
     *
     * @return json cotent
     */
    ping = async () => {
        return {alive: true, platform: configuration.platform}
    }

}