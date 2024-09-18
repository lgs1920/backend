
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

    BACKEND='backend/'
    STUDIO='studio/'
    ASSETS = 'assets/'

    constructor() {
        switch (process.env.NODE_ENV) {
            case 'production':
                this.BACKEND= `../../backend/`
                this.STUDIO = `../../studio/`
                break
            case 'staging':
                break
            default:
                // do nothing
        }
    }

    setStudioDirectory = () => {
        return process.env.NODE_ENV==='production'?`${this.STUDIO}dist`:this.STUDIO
    }

    setBackendDirectory= () => {
        return process.env.NODE_ENV==='production'?`${this.BACKEND}dist`:this.BACKEND
    }

    setStudioFilePath = (name) => {
        return `${this.setStudioDirectory()}${process.env.NODE_ENV === 'production' ? '/' : 'public/'}${name}`
    }
    setBackendFilePath = (obj) => {
        return `${this.setBackendDirectory()}${process.env.NODE_ENV === 'production' ? '/' : '/'}${name}`
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