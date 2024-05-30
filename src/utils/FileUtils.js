import * as fs from 'node:fs'

export class FileUtils {
    /**
     * Sort files by time
     *
     * @param {string} directory
     * @param {array} files
     * @return {Promise:array}
     */
    static sortFilesByTime = async (directory,files) => {
        return files
            .map(fileName => ({
                name: fileName,
                time: fs.statSync(`${directory}/${fileName}`).mtime.getTime(),
            }))
            .sort((a, b) => a.time - b.time)
            .map(file => ({
                    file:file.name,
                    time:file.time
            }));
    };
}