import *   as fspromises from 'node:fs/promises'
import * as path         from 'node:path'
import { FRONTEND }      from '../index'
import { FileUtils }     from '../utils/FileUtils'

export class ChangelogController {

    CHANGELOG_DIR = 'public/changelog/'

    constructor() {
    }

    /**
     * List all changelog files
     *
     * We assume they are all markdown files
     *
     * @param context
     * @return {Promise<{last: *, files: *}>}
     */
    list = async (context) => {
        const directory = `${FRONTEND}${this.CHANGELOG_DIR}`
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
        fileList = await FileUtils.sortFilesByTime(directory, fileList)

        return {
            list: fileList,
            last:  fileList[0],
        }
    }


}