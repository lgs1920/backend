/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 *                                                                                                                    *
 * File: Controller.js                                                                                                *
 * Path: /home/christian/devs/assets/lgs1920/backend/src/controllers/Controller.js                                    *
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
import path              from 'path'
import { configuration } from '../index'

export class Controller {

    // Relative path from api to studio and vice versa
    // In production we are in dist... so ../.. instead of ..

    assets = 'assets/'

    studio = () => {
        return configuration.studio.home
    }
    backend = () => {
        return configuration.backend.home
    }

    studioFilePath = (name) => {
        return path.join(this.studio(), configuration.platform === 'development' ? 'public' : '', name)
    }

    backendFilePath = (name) => {
        return path.join(this.backend(), name)
    }

    assetFilePath = (name) => {
        return this.studioFilePath(path.join(this.assets, name))
    }

    assetDirectoryPath = (name) => {
        return this.assetFilePath(name) + '/'
    }
}