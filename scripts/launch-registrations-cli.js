import {randomUUID} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {existsSync, readFileSync} from 'node:fs'
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline/promises'
import {stdin as input, stdout as output} from 'node:process'
import {LAUNCH_REGISTRATION_DATA_PATH, LAUNCH_REGISTRATION_SCHEMA_VERSION} from '../src/services/LaunchRegistrationStore.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SUPPORTED_SCHEMA_VERSIONS = [1, 2, LAUNCH_REGISTRATION_SCHEMA_VERSION]
const execFileAsync = promisify(execFile)

/**
 * Error raised when the command-line arguments are invalid.
 */
export class LaunchRegistrationCliUsageError extends Error {
    /**
     * Create a command-line usage error.
     *
     * @param {string} message Human-readable usage message.
     */
    constructor(message) {
        super(message)
        this.name = 'LaunchRegistrationCliUsageError'
    }
}

/**
 * Parse the launch-registration administration command arguments.
 *
 * @param {string[]} args Command-line arguments excluding the executable.
 * @returns {{action: 'list'|'remove'|'clear'|'help', email: string|null, confirmed: boolean, clearScope: 'confirmed'|'pending'|'all'|null}} Parsed arguments.
 */
export const parseArguments = (args = []) => {
    let action = null
    let email = null
    let confirmed = false
    let clearScope = null

    const setAction = nextAction => {
        if (action && action !== nextAction) {
            throw new LaunchRegistrationCliUsageError('Choose only one action: --list, --remove <email>, or clear')
        }
        action = nextAction
    }

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index]
        if (argument === '--yes' || argument === '-y') {
            confirmed = true
            continue
        }
        if (['--all', '--confirmed', '--pending'].includes(argument)) {
            const requestedScope = argument.slice(2)
            if (clearScope && clearScope !== requestedScope) {
                throw new LaunchRegistrationCliUsageError('Choose only one clear scope: --confirmed, --pending, or --all')
            }
            clearScope = requestedScope
            continue
        }
        if (argument === '--help' || argument === '-h') {
            setAction('help')
            continue
        }
        if (argument === '--list') {
            setAction('list')
            continue
        }
        if (argument === 'clear' || argument === '--clear') {
            setAction('clear')
            continue
        }
        if (argument === '--remove') {
            setAction('remove')
            email = args[++index]
            if (!email || email.startsWith('-')) {
                throw new LaunchRegistrationCliUsageError('--remove requires an email address')
            }
            continue
        }
        if (argument.startsWith('--remove=')) {
            setAction('remove')
            email = argument.slice('--remove='.length)
            if (!email) {
                throw new LaunchRegistrationCliUsageError('--remove requires an email address')
            }
            continue
        }

        throw new LaunchRegistrationCliUsageError(`Unknown argument: ${argument}`)
    }

    const resolvedAction = action ?? 'help'
    if (clearScope && resolvedAction !== 'clear') {
        throw new LaunchRegistrationCliUsageError('--confirmed, --pending, and --all can only be used with clear')
    }
    if (resolvedAction === 'clear' && !clearScope) {
        clearScope = 'confirmed'
    }

    return {
        action: resolvedAction,
        email:  email?.trim().toLowerCase() || null,
        confirmed,
        clearScope,
    }
}

/**
 * Read the generated backend registration path from the active server configuration.
 *
 * @param {string} [configurationPath=path.resolve(process.cwd(), 'servers.json')] Server configuration path.
 * @returns {string|null} Configured registration path, or null when no path is configured.
 */
export const readConfiguredRegistrationFile = (configurationPath = path.resolve(process.cwd(), 'servers.json')) => {
    if (!existsSync(configurationPath)) {
        return null
    }

    let configuration
    try {
        configuration = JSON.parse(readFileSync(configurationPath, 'utf8'))
    }
    catch (error) {
        throw new Error(`Backend server configuration is not valid JSON: ${configurationPath}`, {cause: error})
    }

    const registrationFile = configuration?.backend?.registrationFile
    return typeof registrationFile === 'string' && registrationFile.trim() ? registrationFile.trim() : null
}

/**
 * Resolve the launch-registration data file used by the current backend.
 *
 * @param {string} [backendHome] Backend home directory override.
 * @returns {string} Absolute registration data path.
 */
export const resolveRegistrationFile = (backendHome = undefined) => {
    const configuredFile = process.env.LGS1920_REGISTRATION_FILE || readConfiguredRegistrationFile()
    const resolvedBackendHome = backendHome || process.env.LGS1920_BACKEND_HOME || process.cwd()
    return path.resolve(configuredFile || path.join(resolvedBackendHome, LAUNCH_REGISTRATION_DATA_PATH))
}

/**
 * Resolve the pending launch-registration data file beside the confirmed file.
 *
 * @param {string} registrationFile Absolute confirmed-registration data path.
 * @returns {string} Absolute pending-registration data path.
 */
export const resolvePendingRegistrationFile = (registrationFile) => {
    const configuredFile = process.env.LGS1920_PENDING_REGISTRATION_FILE
    if (configuredFile) {
        return path.resolve(configuredFile)
    }

    const extension = path.extname(registrationFile)
    if (extension.toLowerCase() !== '.json') {
        return `${registrationFile}-pending`
    }

    return path.join(
        path.dirname(registrationFile),
        `${path.basename(registrationFile, extension)}-pending${extension}`,
    )
}

/**
 * Resolve the PM2 process associated with a deployed backend release.
 *
 * @param {object} [options] Resolution options.
 * @param {string} [options.cwd=process.cwd()] Working directory used for environment detection.
 * @param {NodeJS.ProcessEnv} [options.env=process.env] Environment variables.
 * @returns {{app: string, bin: string}|null} PM2 configuration, or null for local development.
 */
export const resolvePm2Configuration = ({cwd = process.cwd(), env = process.env} = {}) => {
    const explicitApp = env.LGS1920_PM2_APP?.trim()
    const platformMatch = cwd.match(new RegExp(`/${['production', 'staging', 'test'].join('|')}/backend/current(?:/|$)`))
    const platform = platformMatch?.[0]?.split('/')[1]
    const app = explicitApp || (platform ? `backend-${platform}` : null)
    if (!app) {
        return null
    }

    const bin = env.LGS1920_PM2_BIN?.trim() || '/home/.bun/bin/pm2'
    if (!env.LGS1920_PM2_BIN && !existsSync(bin)) {
        return null
    }

    return {app, bin}
}

/**
 * Run one PM2 command without invoking a shell.
 *
 * @param {{app: string, bin: string}} configuration PM2 configuration.
 * @param {string[]} args PM2 arguments.
 * @returns {Promise<void>} Completion promise.
 */
const runPm2 = async ({app, bin}, args) => {
    await execFileAsync(bin, [...args, app], {encoding: 'utf8'})
}

/**
 * Stop the active PM2 backend when the command runs from a deployed release.
 *
 * @returns {Promise<{app: string, bin: string}|null>} Stopped process configuration.
 */
const stopPm2Backend = async () => {
    const configuration = resolvePm2Configuration()
    if (!configuration) {
        return null
    }

    try {
        await runPm2(configuration, ['describe'])
    }
    catch {
        return null
    }

    console.log(`Stopping PM2 (${configuration.app})...`)
    await runPm2(configuration, ['stop'])
    return configuration
}

/**
 * Start a PM2 backend stopped by this command.
 *
 * @param {{app: string, bin: string}|null} configuration Stopped process configuration.
 * @returns {Promise<void>} Completion promise.
 */
const startPm2Backend = async (configuration) => {
    if (!configuration) {
        return
    }

    console.log(`Restarting PM2 (${configuration.app})...`)
    await runPm2(configuration, ['start'])
}

/**
 * Run one destructive operation while the deployed backend is stopped.
 *
 * @param {() => Promise<*>} operation Administrative operation.
 * @returns {Promise<*>} Operation result.
 */
const withBackendStopped = async operation => {
    const configuration = await stopPm2Backend()
    try {
        return await operation()
    }
    finally {
        await startPm2Backend(configuration)
    }
}

/**
 * Read and validate the persisted launch-registration envelope.
 *
 * @param {string} filePath Registration data path.
 * @returns {Promise<{schemaVersion: number, registrations: object[]}>} Persisted data.
 */
export const readRegistrationFile = async (filePath) => {
    let content
    try {
        content = await readFile(filePath, 'utf8')
    }
    catch (error) {
        if (error?.code === 'ENOENT') {
            return {schemaVersion: LAUNCH_REGISTRATION_SCHEMA_VERSION, registrations: []}
        }
        throw error
    }

    let persisted
    try {
        persisted = JSON.parse(content)
    }
    catch (error) {
        throw new Error(`Registration data is not valid JSON: ${filePath}`, {cause: error})
    }

    if (!persisted || typeof persisted !== 'object' || !SUPPORTED_SCHEMA_VERSIONS.includes(persisted.schemaVersion) || !Array.isArray(persisted.registrations)) {
        throw new Error(`Registration data has an invalid format: ${filePath}`)
    }

    return persisted
}

/**
 * Persist registrations through a temporary file and atomic rename.
 *
 * @param {string} filePath Registration data path.
 * @param {object[]} registrations Registrations to persist.
 * @returns {Promise<void>} Completion promise.
 */
export const writeRegistrationFile = async (filePath, registrations) => {
    await mkdir(path.dirname(filePath), {recursive: true})
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
    const payload = JSON.stringify({
        schemaVersion: LAUNCH_REGISTRATION_SCHEMA_VERSION,
        registrations,
    }, null, 2)

    try {
        await writeFile(temporaryPath, `${payload}\n`, {encoding: 'utf8', mode: 0o600})
        await rename(temporaryPath, filePath)
    }
    catch (error) {
        await rm(temporaryPath, {force: true}).catch(() => undefined)
        throw error
    }
}

/**
 * Convert private registration records into safe administrative list rows.
 *
 * @param {object[]} registrations Persisted registrations.
 * @returns {object[]} Rows without cancellation token hashes.
 */
export const formatRegistrationRows = (registrations) => registrations.map(registration => ({
    firstName: registration.firstName,
    lastName:  registration.lastName,
    email:     registration.email,
    createdAt: registration.createdAt,
}))

/**
 * Remove all registrations matching one normalized email address.
 *
 * @param {string} filePath Registration data path.
 * @param {string} email Email address to remove.
 * @returns {Promise<{removed: number, remaining: number}>} Removal result.
 */
export const removeRegistrations = async (filePath, email) => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
        throw new LaunchRegistrationCliUsageError('Invalid email address')
    }

    const persisted = await readRegistrationFile(filePath)
    const remaining = persisted.registrations.filter(registration => registration?.email?.trim().toLowerCase() !== normalizedEmail)
    const removed = persisted.registrations.length - remaining.length
    if (removed > 0) {
        await writeRegistrationFile(filePath, remaining)
    }

    return {removed, remaining: remaining.length}
}

/**
 * Remove every persisted launch registration.
 *
 * @param {string} filePath Registration data path.
 * @returns {Promise<{removed: number}>} Removal result.
 */
export const clearRegistrations = async (filePath) => {
    const persisted = await readRegistrationFile(filePath)
    if (persisted.registrations.length > 0) {
        await writeRegistrationFile(filePath, [])
    }
    return {removed: persisted.registrations.length}
}

/**
 * Select the data files covered by a clear scope.
 *
 * @param {'confirmed'|'pending'|'all'} scope Clear scope.
 * @param {string} registrationFile Confirmed-registration data path.
 * @param {string} pendingFile Pending-registration data path.
 * @returns {{confirmed: string|null, pending: string|null}} Selected data store paths.
 */
const getClearSelection = (scope, registrationFile, pendingFile) => ({
    confirmed: scope === 'confirmed' || scope === 'all' ? registrationFile : null,
    pending:   scope === 'pending' || scope === 'all' ? pendingFile : null,
})

/**
 * Read the number of records selected by a clear scope.
 *
 * @param {'confirmed'|'pending'|'all'} scope Clear scope.
 * @param {string} registrationFile Confirmed-registration data path.
 * @param {string} pendingFile Pending-registration data path.
 * @returns {Promise<{confirmed: number, pending: number}>} Selected record counts.
 */
const readClearCounts = async (scope, registrationFile, pendingFile) => {
    const selection = getClearSelection(scope, registrationFile, pendingFile)
    const [confirmed, pending] = await Promise.all([
        selection.confirmed ? readRegistrationFile(selection.confirmed) : {registrations: []},
        selection.pending ? readRegistrationFile(selection.pending) : {registrations: []},
    ])

    return {
        confirmed: confirmed.registrations.length,
        pending:   pending.registrations.length,
    }
}

/**
 * Clear the data stores selected by a clear scope.
 *
 * @param {'confirmed'|'pending'|'all'} scope Clear scope.
 * @param {string} registrationFile Confirmed-registration data path.
 * @param {string} pendingFile Pending-registration data path.
 * @returns {Promise<{confirmed: number, pending: number}>} Number of removed records by state.
 */
export const clearByScope = async (scope, registrationFile, pendingFile) => {
    const selection = getClearSelection(scope, registrationFile, pendingFile)
    const [confirmed, pending] = await Promise.all([
        selection.confirmed ? clearRegistrations(selection.confirmed) : {removed: 0},
        selection.pending ? clearRegistrations(selection.pending) : {removed: 0},
    ])

    return {
        confirmed: confirmed.removed,
        pending:   pending.removed,
    }
}

const printHelp = () => {
    console.log('Usage: bun launch-registrations.js --list')
    console.log('       bun launch-registrations.js --remove <email> [--yes]')
    console.log('       bun launch-registrations.js clear [--confirmed|--pending|--all] [--yes]')
    console.log('')
    console.log('The command operates on the backend data file selected by LGS1920_REGISTRATION_FILE or the current backend data directory.')
}

const confirm = async question => {
    if (!input.isTTY) {
        return false
    }

    const prompt = readline.createInterface({input, output})
    try {
        const answer = await prompt.question(`${question} [y/N] `)
        return ['y', 'yes', 'o', 'oui'].includes(answer.trim().toLowerCase())
    }
    finally {
        prompt.close()
    }
}

/**
 * Run the launch-registration administration command.
 *
 * @param {string[]} [args] Command-line arguments excluding the executable.
 * @returns {Promise<void>} Completion promise.
 */
export const run = async (args = process.argv.slice(2)) => {
    const options = parseArguments(args)
    if (options.action === 'help') {
        printHelp()
        return
    }

    const filePath = resolveRegistrationFile()
    if (options.action === 'list') {
        const persisted = await readRegistrationFile(filePath)
        const rows = formatRegistrationRows(persisted.registrations)
        if (rows.length === 0) {
            console.log('No registrations.')
            return
        }
        console.table(rows)
        return
    }

    if (options.action === 'remove') {
        const persisted = await readRegistrationFile(filePath)
        const matching = persisted.registrations.filter(registration => registration?.email?.trim().toLowerCase() === options.email)
        if (matching.length === 0) {
            console.log(`No registration found for ${options.email}.`)
            return
        }
        if (!options.confirmed && !await confirm(`Delete the registration for ${options.email}?`)) {
            console.log('Deletion cancelled.')
            return
        }
        const result = await withBackendStopped(() => removeRegistrations(filePath, options.email))
        console.log(`${result.removed} registration(s) deleted.`)
        return
    }

    const pendingFilePath = resolvePendingRegistrationFile(filePath)
    const counts = await readClearCounts(options.clearScope, filePath, pendingFilePath)
    const confirmedCount = counts.confirmed
    const pendingCount = counts.pending
    if (confirmedCount === 0 && pendingCount === 0) {
        console.log('No registrations to delete.')
        return
    }
    const question = options.clearScope === 'all'
        ? `Delete all ${confirmedCount} confirmed and ${pendingCount} pending registrations?`
        : options.clearScope === 'pending'
            ? `Delete all ${pendingCount} pending registrations?`
            : `Delete all ${confirmedCount} confirmed registrations?`
    if (!options.confirmed && !await confirm(question)) {
        console.log('Deletion cancelled.')
        return
    }
    const result = await withBackendStopped(() => clearByScope(options.clearScope, filePath, pendingFilePath))
    const deleted = options.clearScope === 'all'
        ? `${result.confirmed} confirmed registration(s) and ${result.pending} pending registration(s)`
        : options.clearScope === 'pending'
            ? `${result.pending} pending registration(s)`
            : `${result.confirmed} confirmed registration(s)`
    console.log(`${deleted} deleted.`)
}

if (import.meta.main) {
    run().catch(error => {
        console.error(error instanceof LaunchRegistrationCliUsageError ? error.message : 'Unable to update launch registrations')
        process.exitCode = 1
    })
}
