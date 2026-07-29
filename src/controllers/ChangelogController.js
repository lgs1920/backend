/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 *                                                                                                                    *
 * File: ChangelogController.js                                                                                       *
 * Path: /home/christian/devs/assets/lgs1920/backend/src/controllers/ChangelogController.js                           *
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

import *   as fspromises from 'node:fs/promises'
import * as path      from 'node:path'
import { FileUtils }  from '../utils/FileUtils'
import { resolveSafeChildPath } from '../utils/PathSecurity.js'
import { Controller } from './Controller'

export class ChangelogController extends Controller {

    CHANGELOG_DIR = 'changelog'

    /**
     * List all changelog files
     *
     * We assume they are all markdown files
     *
     * @param context
     * @return {Promise<{last: *, files: *}>}
     */
    list = async (context) => {
        const directory = this.assetDirectoryPath(this.CHANGELOG_DIR)
        let extension = context.query.extension
        if (extension && !extension.startsWith('.')) {
            extension = `.${extension}`;
        }

        let fileList = await fspromises.readdir(directory)
        // Filter the list by extension
        if (extension) {
            fileList = fileList.filter(file => path.extname(file).toLowerCase() === extension)
        }
        // Sort
        fileList = await FileUtils.sortFilesByVersionNumber({
                                                       files:  fileList,
                                                       extension: extension,
                                                   })

        return {
            list: fileList,
            last:  fileList[0],
        }
    }

    /**
     * Read one Markdown changelog file from the configured changelog directory.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Changelog content or a controlled client error.
     */
    read = async({params: {file}, set})=> {
        let decodedFile
        try {
            decodedFile = decodeURIComponent(file)
        }
        catch {
            set.status = 400
            return {success: false, error: 'Invalid changelog file name'}
        }

        const directory = path.resolve(this.assetDirectoryPath(this.CHANGELOG_DIR))
        const target = resolveSafeChildPath(directory, decodedFile)
        if (!target || path.extname(decodedFile).toLowerCase() !== '.md' || path.basename(decodedFile) !== decodedFile) {
            set.status = 400
            return {success: false, error: 'Invalid changelog file name'}
        }

        try {
            return {content: await fspromises.readFile(target, 'utf8')}
        }
        catch {
            set.status = 404
            return {success: false, error: 'Changelog file not found'}
        }
    }


}
