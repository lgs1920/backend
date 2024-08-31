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
    static sortFilesByVersionNumber = async ({directory,files,ascendant=false,extension='',separator = '-'}) => {
        const sortFunction = (a, b) => ascendant ? compareVersions(a.version, b.version) : compareVersions(b.version, a.version)

        return files
            .map(fileName => {
                const [date,version] = fileName.split(separator, 2)
                return {
                    version: version.split(extension)[0],
                    file:    fileName,
                    time:    DateTime.fromFormat(date, 'yyyyMMdd').toMillis(),
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