import path from 'node:path'

/**
 * Resolve a user-supplied path below a fixed directory.
 *
 * @param {string} root Allowed root directory.
 * @param {string} requestedPath Relative user-supplied path.
 * @returns {string|null} Safe absolute path, or null when traversal is attempted.
 */
export const resolveSafeChildPath = (root, requestedPath) => {
    if (typeof root !== 'string' || !root || typeof requestedPath !== 'string' || !requestedPath || requestedPath.includes('\0')) {
        return null
    }

    const rootPath = path.resolve(root)
    const targetPath = path.resolve(rootPath, requestedPath)
    const relativePath = path.relative(rootPath, targetPath)
    if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        return null
    }

    return targetPath
}
