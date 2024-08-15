import { compareVersions } from 'compare-versions'
import { DateTime }        from 'luxon'

export class FileUtils {
    /**
     * Sort files by time
     *
     * @param {string} directory
     * @param {array} files
     *
     * @return {Promise:array}
     */
    static sortFilesByVersionNumber = async ({directory,files,ascendant=false,extension=''}) => {
        const sortFunction = (a, b) => ascendant ? compareVersions(a.version, b.version) : compareVersions(b.version, a.version)

        return files
            .map(fileName => {
                const data = fileName.split(' ', 2)
                return {
                    version: data[1].split(extension)[0],
                    file:    data[1],
                    time:    DateTime.fromFormat(data[0], 'yyyyMMdd').toMillis(),
                }
            })
            .sort(sortFunction)
            .map(file => ({
                file:    file.file,
                version: file.version,
                    time:file.time
            }));
    };
}