import * as fs from 'node:fs'

export class FileUtils {
    /**
     * Sort files by time
     *
     * @param {string} directory
     * @param {array} files
     * @return {Promise:array}
     */
    static sortFilesByTime = async (directory,files,ascendant=false) => {
        const sortFunction = ascendant
        ?(a, b) => a.time - b.time
        :(a, b) => b.time - a.time
        return files
            .map(fileName => ({
                name: fileName,
                time: fs.statSync(`${directory}/${fileName}`).mtime.getTime(),
            }))
            .sort((a,b)=>ascendant)
            .map(file => ({
                    file:file.name,
                    time:file.time
            }));
    };
}