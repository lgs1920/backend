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
 * Created on: 2024-09-18                                                                                             *
 * Last modified: 2024-09-18                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2024 LGS1920                                                                                           *
 *                                                                                                                    *
 **********************************************************************************************************************/

export class Controller {

    // Relative path from api to studio and vice versa
    // In production we are in dist... so ../.. instead of ..

    BACKEND = '../backend/'
    STUDIO = '../studio/'
    ASSETS = 'assets/'

    constructor() {
        switch (process.env.NODE_ENV) {
            case 'production':
                this.BACKEND = `../../backend/prod/`
                this.STUDIO = `../../studio/prod/`
                break
            case 'staging':
                this.BACKEND = `../../backend/staging/`
                this.STUDIO = `../../studio/staging/`
                break
            case 'test':
                this.BACKEND = `../../backend/test/`
                this.STUDIO = `../studio/test/`
                break
            default:
                // do nothing
        }
    }

    setStudioDirectory = () => {
        return process.env.NODE_ENV === 'development' ? this.STUDIO : `${this.STUDIO}/current`
    }

    setBackendDirectory= () => {
        return process.env.NODE_ENV === 'development' ? this.BACKEND : `${this.BACKEND}/current`
    }

    setStudioFilePath = (name) => {
        return `${this.setStudioDirectory()}${process.env.NODE_ENV === 'development' ? 'public/' : '/'}${name}`
    }
    setBackendFilePath = (name) => {
        return `${this.setBackendDirectory()}${process.env.NODE_ENV === 'development' ? '/' : '/'}${name}`
    }

    setPublicDirectoryPath =(name) => {
        return this.setStudioFilePath(name)+'/'
    }

    setAssetFilePath= (name) => {
        return this.setStudioFilePath(`${this.ASSETS}${name}`)
    }

    setAssetDirectoryPath= (name) => {
        return this.setAssetFilePath(name)+'/'
    }
}