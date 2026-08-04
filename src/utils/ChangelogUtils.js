/**
 * Normalize an optional changelog file extension.
 *
 * @param {unknown} extension Requested file extension.
 * @returns {string|undefined} Normalized extension or undefined when absent.
 */
export const normalizeChangelogExtension = (extension) => {
    if (typeof extension !== 'string' || extension.length === 0) {
        return undefined
    }

    return extension.startsWith('.') ? extension : `.${extension}`
}
