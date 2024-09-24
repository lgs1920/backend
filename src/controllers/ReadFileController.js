/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 *                                                                                                                    *
 * File: ReadFileController.js                                                                                        *
 * Path: /home/christian/devs/assets/lgs1920/backend/src/controllers/ReadFileController.js                            *
 *                                                                                                                    *
 * Author : Christian Denat                                                                                           *
 * email: christian.denat@orange.fr                                                                                   *
 *                                                                                                                    *
 * Created on: 2024-09-24                                                                                             *
 * Last modified: 2024-09-24                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2024 LGS1920                                                                                           *
 *                                                                                                                    *
 **********************************************************************************************************************/

import { Controller } from './Controller'
import axios          from 'axios'
import fs             from 'fs'

export class ReadFileController extends Controller {

    readFile = async ({query}) => {

        if (query.file.startsWith('http')) {
            // read a remote file
            try {
                const response = await axios.get(query.file)
                return response.data
            }
            catch (error) {
                console.error(`Error : ${error.message}`)
                return {success: false}
            }
        }
        else {
            // read a local file
            const path = query.path === 'backend' ? this.backend() : this.studio()
            const file = [path, query.file].join('/')
            return new Promise(async (resolve, reject) => {
                fs.readFile(file, 'utf8', (err, data) => {
                    if (err) {
                        reject(`Error : ${err.message}`)
                        return {success: false}
                    }
                    else {
                        resolve(data)
                    }
                })
            })
        }
    }


}