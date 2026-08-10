import {execFile} from 'node:child_process'
import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {promisify} from 'node:util'
import {resolvePm2Configuration} from './launch-registrations-cli.js'

const execFileAsync = promisify(execFile)

/**
 * Error raised when the backend process command cannot be configured.
 */
export class BackendProcessCliError extends Error {
    /**
     * Create a backend process command error.
     *
     * @param {string} message Human-readable error message.
     */
    constructor(message) {
        super(message)
        this.name = 'BackendProcessCliError'
    }
}

/**
 * Parse a shell-compatible environment file without invoking a shell.
 *
 * @param {string} content Environment file content.
 * @returns {Record<string, string>} Parsed environment values.
 */
export const parseEnvironmentFile = (content) => {
    const environment = {}
    for (const [lineNumber, rawLine] of content.split(/\r?\n/u).entries()) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) {
            continue
        }

        const assignment = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u)
        if (!assignment) {
            throw new BackendProcessCliError(`Invalid environment assignment on line ${lineNumber + 1}`)
        }

        const [, key, rawValue] = assignment
        const value = rawValue.trim()
        if ((value.startsWith("'") && !value.endsWith("'")) || (value.startsWith('"') && !value.endsWith('"'))) {
            throw new BackendProcessCliError(`Unterminated environment value on line ${lineNumber + 1}`)
        }

        environment[key] = (value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))
            ? value.slice(1, -1)
            : value
    }

    return environment
}

/**
 * Resolve the deployed backend process paths.
 *
 * @param {object} [options] Resolution options.
 * @param {string} [options.cwd=process.cwd()] Active backend directory.
 * @param {NodeJS.ProcessEnv} [options.env=process.env] Environment variables.
 * @returns {{app: string, bin: string, cwd: string, ecosystemPath: string, environmentPath: string}|null} Process configuration.
 */
export const resolveBackendProcessConfiguration = ({cwd = process.cwd(), env = process.env} = {}) => {
    const pm2 = resolvePm2Configuration({cwd, env})
    if (!pm2) {
        return null
    }

    return {
        ...pm2,
        cwd:              path.resolve(cwd),
        ecosystemPath:    path.resolve(cwd, 'ecosystem.config.js'),
        environmentPath: path.resolve(cwd, '../shared/backend.env'),
    }
}

/**
 * Run a PM2 command without invoking a shell.
 *
 * @param {{app: string, bin: string}} configuration PM2 configuration.
 * @param {string[]} args PM2 arguments.
 * @param {NodeJS.ProcessEnv} [env=process.env] Child process environment.
 * @returns {Promise<void>} Completion promise.
 */
const runPm2 = async (configuration, args, env = process.env) => {
    await execFileAsync(configuration.bin, args, {encoding: 'utf8', env})
}

/**
 * Print the backend process command help.
 */
const printHelp = () => {
    console.log('Usage: bun backend-process.js stop')
    console.log('       bun backend-process.js start')
    console.log('')
    console.log('stop gracefully stops the PM2-managed backend.')
    console.log('start loads the shared environment and starts or restarts the backend with PM2.')
}

/**
 * Load the shared backend environment when it exists.
 *
 * @param {{environmentPath: string}} configuration Process configuration.
 * @returns {Promise<NodeJS.ProcessEnv>} Child process environment.
 */
const loadProcessEnvironment = async configuration => {
    if (!existsSync(configuration.environmentPath)) {
        if (configuration.cwd.match(new RegExp('/(?:production|staging|test)/backend/current(?:/|$)'))) {
            throw new BackendProcessCliError(`Shared backend environment file not found: ${configuration.environmentPath}`)
        }
        return {...process.env}
    }

    const content = await readFile(configuration.environmentPath, 'utf8')
    return {
        ...process.env,
        ...parseEnvironmentFile(content),
    }
}

/**
 * Check whether a PM2 application is registered.
 *
 * @param {{app: string, bin: string}} configuration Process configuration.
 * @returns {Promise<boolean>} Whether PM2 knows the application.
 */
const isRegistered = async configuration => {
    try {
        await runPm2(configuration, ['describe', configuration.app])
        return true
    }
    catch {
        return false
    }
}

/**
 * Stop or start the PM2-managed backend.
 *
 * @param {string} [action] Requested action.
 * @returns {Promise<void>} Completion promise.
 */
export const run = async (action = process.argv[2]) => {
    if (action === '--help' || action === '-h' || !action) {
        printHelp()
        return
    }
    if (!['stop', 'start'].includes(action)) {
        throw new BackendProcessCliError(`Unknown action: ${action}`)
    }

    const configuration = resolveBackendProcessConfiguration()
    if (!configuration) {
        throw new BackendProcessCliError('No deployed PM2 backend detected. Run this command from an active backend release or configure LGS1920_PM2_APP and LGS1920_PM2_BIN.')
    }

    if (action === 'stop') {
        if (!await isRegistered(configuration)) {
            console.log(`PM2 application ${configuration.app} is not registered.`)
            return
        }
        await runPm2(configuration, ['stop', configuration.app])
        console.log(`Backend ${configuration.app} stopped successfully.`)
        return
    }

    if (!existsSync(configuration.ecosystemPath)) {
        throw new BackendProcessCliError(`PM2 ecosystem file not found: ${configuration.ecosystemPath}`)
    }

    const environment = await loadProcessEnvironment(configuration)
    await runPm2(configuration, [
        'startOrRestart',
        configuration.ecosystemPath,
        '--cwd',
        configuration.cwd,
        '--update-env',
    ], environment)
    await runPm2(configuration, ['save'], environment)
    console.log(`Backend ${configuration.app} started successfully.`)
}

if (import.meta.main) {
    run().catch(error => {
        console.error(error instanceof BackendProcessCliError ? error.message : 'Unable to manage the backend process')
        process.exitCode = 1
    })
}
