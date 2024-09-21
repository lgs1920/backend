
/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 *                                                                                                                    *
 * File: VersionsController.js                                                                                        *
 * Path: /home/christian/devs/assets/lgs1920/backend/src/controllers/VersionsController.js                            *
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

import { configuration } from '../index'
import { Controller }    from './Controller'

export class VersionsController extends Controller{

    /**
     * Read all versions and return the
     *
     * @return json cotent
     */
    versions = async () => {
        const backend = await Bun.file(this.backendFilePath('version.json')).json()
        const studio = await Bun.file(this.studioFilePath('version.json')).json()
        return {...{platform: configuration.platform}, ...studio, ...backend}
    }

}