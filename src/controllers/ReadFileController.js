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
import { readFile, stat } from 'node:fs/promises'
import { resolveSafeChildPath } from '../utils/PathSecurity.js'

export class ReadFileController extends Controller {

    /**
     * Resolve a requested local file below one configured backend or Studio root.
     *
     * @param {string} root Allowed root directory.
     * @param {string} file Requested relative file path.
     * @returns {string|null} Safe absolute path, or null when traversal is attempted.
     */
    resolveSafePath = (root, file) => {
        return resolveSafeChildPath(root, file)
    }

    /**
     * Read a bounded local file from a configured application root.
     *
     * Remote URL reads are intentionally disabled to prevent SSRF. Path
     * traversal is rejected before the filesystem is accessed.
     *
     * @param {object} context Elysia request context.
     * @returns {Promise<object>} Safe file response.
     */
    readFile = async ({query, set}) => {
        const requestedFile = typeof query?.file === 'string' ? query.file : ''
        if (/^[a-z][a-z\d+.-]*:/i.test(requestedFile)) {
            set.status = 400
            return {success: false, error: 'Remote file reads are disabled'}
        }

        const root = query?.path === 'backend'
                     ? this.backend()
                     : query?.path === 'studio' || query?.path === undefined
                         ? this.studio()
                         : null
        const targetPath = this.resolveSafePath(root, requestedFile)
        if (!targetPath) {
            set.status = 400
            return {success: false, error: 'Invalid local file path'}
        }

        const configuredLimit = Number(process.env.LGS1920_MAX_READ_FILE_BYTES ?? 5 * 1024 * 1024)
        const maxBytes = Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 5 * 1024 * 1024

        try {
            const fileStats = await stat(targetPath)
            if (!fileStats.isFile() || fileStats.size > maxBytes) {
                set.status = 413
                return {success: false, error: 'File is unavailable or exceeds the configured size limit'}
            }

            return {success: true, content: await readFile(targetPath, 'utf8')}
        }
        catch {
            set.status = 404
            return {success: false, error: 'File not found'}
        }
    }


}
