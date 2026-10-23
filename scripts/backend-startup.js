import {execFile} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {promisify} from 'node:util'

const execFileAsync = promisify(execFile)
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u

/**
 * Parse the restricted shell-style environment file used by backend deployments.
 *
 * @param {string} content Environment file content.
 * @returns {Record<string, string>} Parsed environment values.
 */
export const parseEnvironmentFile = content => {
    const environment = {}
    for (const [lineNumber, rawLine] of content.split(/\r?\n/u).entries()) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) {
            continue
        }

        const assignment = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u)
        if (!assignment || !ENVIRONMENT_NAME_PATTERN.test(assignment[1])) {
            throw new Error(`Invalid backend environment assignment on line ${lineNumber + 1}`)
        }

        const [, key, rawValue] = assignment
        const value = rawValue.trim()
        const isQuoted = (value.startsWith("'") && value.endsWith("'"))
            || (value.startsWith('"') && value.endsWith('"'))
        if ((value.startsWith("'") || value.startsWith('"')) && (!isQuoted || value.length < 2)) {
            throw new Error(`Unterminated backend environment value on line ${lineNumber + 1}`)
        }

        environment[key] = isQuoted ? value.slice(1, -1) : value
    }

    return environment
}

/**
 * Start or restart the deployed backend with its shared environment.
 *
 * @param {object} options Startup options.
 * @param {string} options.backendPath Active backend release path.
 * @param {string} options.environmentFile Shared backend environment path.
 * @param {string} options.pm2Bin Absolute PM2 executable path.
 * @returns {Promise<void>} Resolves after PM2 has saved the process list.
 */
export const startBackend = async ({backendPath, environmentFile, pm2Bin} = {}) => {
    if (!path.isAbsolute(backendPath) || !path.isAbsolute(environmentFile) || !path.isAbsolute(pm2Bin)) {
        throw new Error('Backend startup paths must be absolute')
    }

    const environment = {
        ...process.env,
        ...parseEnvironmentFile(await readFile(environmentFile, 'utf8')),
    }
    const ecosystemFile = path.join(backendPath, 'ecosystem.config.js')
    await execFileAsync(pm2Bin, ['startOrRestart', ecosystemFile, '--cwd', backendPath, '--update-env'], {
        cwd: backendPath,
        env: environment,
    })
    await execFileAsync(pm2Bin, ['save'], {cwd: backendPath, env: environment})
}

/**
 * Read one command-line option from a startup invocation.
 *
 * @param {string[]} argumentsList Command-line arguments.
 * @param {string} name Option name.
 * @returns {string} Option value.
 */
const readOption = (argumentsList, name) => {
    const index = argumentsList.indexOf(name)
    const value = index >= 0 ? argumentsList[index + 1] : undefined
    if (!value || value.startsWith('--')) {
        throw new Error(`Missing startup option: ${name}`)
    }
    return value
}

if (import.meta.main) {
    startBackend({
        backendPath:     readOption(process.argv.slice(2), '--backend-path'),
        environmentFile: readOption(process.argv.slice(2), '--environment-file'),
        pm2Bin:           readOption(process.argv.slice(2), '--pm2-bin'),
    }).catch(error => {
        console.error(`[ERROR] Backend startup failed: ${error.message}`)
        process.exitCode = 1
    })
}
