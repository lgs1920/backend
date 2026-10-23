import {execFile} from 'node:child_process'
import {mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {promisify} from 'node:util'
import nodemailer from 'nodemailer'
import {parseEnvironmentFile} from './backend-startup.js'

const execFileAsync = promisify(execFile)
const DEFAULT_TIMEOUT_MS = 5_000
const FAILURE_THRESHOLD = 2
const RESTART_COOLDOWN_MS = 30 * 60 * 1_000
const LOCK_STALE_AFTER_MS = 10 * 60 * 1_000

/**
 * Read one bounded SMTP timeout value.
 *
 * @param {string|undefined} value Configured timeout value.
 * @param {number} fallback Default timeout.
 * @returns {number} Safe timeout in milliseconds.
 */
const readSmtpTimeout = (value, fallback) => {
    const timeout = Number(value)
    return Number.isInteger(timeout) && timeout >= 1_000 && timeout <= 120_000 ? timeout : fallback
}

/**
 * Probe the backend liveness endpoint without exposing its response body.
 *
 * @param {object} options Probe options.
 * @param {string} options.url Liveness endpoint URL.
 * @param {number} [options.timeoutMs=5000] Request timeout.
 * @param {typeof fetch} [options.fetchImpl=fetch] Fetch implementation.
 * @returns {Promise<{ok: boolean, reason?: string}>} Probe result.
 */
export const probeBackend = async ({url, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch} = {}) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
        const response = await fetchImpl(url, {
            headers: {'Accept': 'application/json'},
            signal:  controller.signal,
        })
        if (!response.ok) {
            return {ok: false, reason: `HTTP ${response.status}`}
        }

        const payload = await response.json()
        return payload?.alive === true
            ? {ok: true}
            : {ok: false, reason: 'Invalid liveness response'}
    }
    catch (error) {
        return {ok: false, reason: error.name === 'AbortError' ? 'Request timeout' : 'Request failed'}
    }
    finally {
        clearTimeout(timeout)
    }
}

/**
 * Decide whether a persistent failure is allowed to trigger a restart.
 *
 * @param {object} state Watchdog state.
 * @param {number} now Current timestamp.
 * @returns {boolean} Whether a restart is allowed.
 */
export const shouldRestartBackend = (state, now = Date.now()) => state.consecutiveFailures >= FAILURE_THRESHOLD
    && (!state.lastRestartAt || now - state.lastRestartAt >= RESTART_COOLDOWN_MS)

/**
 * Load a watchdog state file, returning a safe initial state when unavailable.
 *
 * @param {string} statePath Persistent state path.
 * @returns {Promise<object>} Watchdog state.
 */
export const readWatchdogState = async statePath => {
    try {
        const state = JSON.parse(await readFile(statePath, 'utf8'))
        return {
            consecutiveFailures: Number.isSafeInteger(state.consecutiveFailures) ? state.consecutiveFailures : 0,
            lastRestartAt:        Number.isFinite(state.lastRestartAt) ? state.lastRestartAt : null,
            outageActive:         state.outageActive === true,
        }
    }
    catch {
        return {consecutiveFailures: 0, lastRestartAt: null, outageActive: false}
    }
}

/**
 * Persist watchdog state atomically enough for one user-level cron worker.
 *
 * @param {string} statePath Persistent state path.
 * @param {object} state Watchdog state.
 * @returns {Promise<void>} Resolves after the state is written.
 */
export const writeWatchdogState = async (statePath, state) => {
    await mkdir(path.dirname(statePath), {recursive: true, mode: 0o700})
    const temporaryPath = `${statePath}.${process.pid}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, {mode: 0o600})
    await rename(temporaryPath, statePath)
}

/**
 * Acquire a stale-safe lock for one watchdog invocation.
 *
 * @param {string} lockPath Lock directory path.
 * @returns {Promise<boolean>} Whether the lock was acquired.
 */
const acquireLock = async lockPath => {
    try {
        await mkdir(lockPath, {recursive: false, mode: 0o700})
        await writeFile(path.join(lockPath, 'owner'), `${process.pid}\n`, {mode: 0o600})
        return true
    }
    catch (error) {
        if (error.code !== 'EEXIST') {
            throw error
        }

        try {
            const details = await stat(lockPath)
            if (Date.now() - details.mtimeMs > LOCK_STALE_AFTER_MS) {
                await rm(lockPath, {recursive: true, force: true})
                return acquireLock(lockPath)
            }
        }
        catch {
            return false
        }
        return false
    }
}

/**
 * Send one operational watchdog alert when alerting is configured.
 *
 * @param {object} options Alert options.
 * @param {NodeJS.ProcessEnv} options.environment Loaded backend environment.
 * @param {string} options.platform Backend platform.
 * @param {string} options.status Alert status.
 * @param {string} options.detail Safe alert detail.
 * @returns {Promise<boolean>} Whether an email was sent.
 */
export const sendWatchdogAlert = async ({environment, platform, status, detail}) => {
    const recipient = environment.LGS1920_WATCHDOG_ALERT_TO?.trim()
    if (!recipient) {
        return false
    }

    const host = environment.LGS1920_SMTP_HOST?.trim()
    const password = environment.LGS1920_SMTP_PASSWORD
    const sender = environment.LGS1920_WATCHDOG_ALERT_FROM?.trim() || environment.LGS1920_SMTP_USER?.trim() || recipient
    if (!host) {
        throw new Error('Watchdog SMTP host is not configured')
    }

    const port = Number(environment.LGS1920_SMTP_PORT || 465)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Watchdog SMTP port is invalid')
    }
    if (environment.LGS1920_SMTP_SECURE !== undefined && !['true', 'false'].includes(environment.LGS1920_SMTP_SECURE)) {
        throw new Error('Watchdog SMTP secure mode is invalid')
    }
    const secure = environment.LGS1920_SMTP_SECURE === undefined
        ? port === 465
        : environment.LGS1920_SMTP_SECURE === 'true'
    if (port === 465 && !secure) {
        throw new Error('Watchdog SMTP port 465 requires implicit TLS')
    }
    const transport = nodemailer.createTransport({
        host,
        port,
        secure,
        requireTLS: !secure,
        tls: {rejectUnauthorized: true},
        connectionTimeout: readSmtpTimeout(environment.LGS1920_SMTP_CONNECTION_TIMEOUT_MS, 15_000),
        greetingTimeout:   readSmtpTimeout(environment.LGS1920_SMTP_GREETING_TIMEOUT_MS, 10_000),
        socketTimeout:     readSmtpTimeout(environment.LGS1920_SMTP_SOCKET_TIMEOUT_MS, 30_000),
        auth: password ? {user: environment.LGS1920_SMTP_USER?.trim() || sender, pass: password} : undefined,
    })

    await transport.sendMail({
        from: sender,
        to: recipient,
        subject: `[LGS1920] Backend ${platform}: ${status}`,
        text: `Backend platform: ${platform}\nStatus: ${status}\nDetail: ${detail}\nTime: ${new Date().toISOString()}\n`,
    })
    return true
}

/**
 * Restart one PM2 backend process without invoking a shell.
 *
 * @param {object} options Restart options.
 * @param {string} options.pm2Bin Absolute PM2 executable path.
 * @param {string} options.pm2App PM2 application name.
 * @param {NodeJS.ProcessEnv} options.environment Process environment.
 * @returns {Promise<void>} Resolves after PM2 accepts the restart.
 */
export const restartBackend = async ({pm2Bin, pm2App, environment}) => {
    await execFileAsync(pm2Bin, ['restart', pm2App], {env: environment})
}

/**
 * Execute one watchdog cycle.
 *
 * @param {object} options Watchdog options.
 * @param {string} options.platform Backend platform.
 * @param {string} options.url Liveness endpoint URL.
 * @param {string} options.pm2Bin Absolute PM2 executable path.
 * @param {string} options.pm2App PM2 application name.
 * @param {string} options.environmentFile Shared environment path.
 * @param {string} options.statePath Persistent state path.
 * @param {number} [options.now=Date.now()] Current timestamp.
 * @param {Function} [options.probe=probeBackend] Probe implementation.
 * @param {Function} [options.restart=restartBackend] Restart implementation.
 * @param {Function} [options.alert=sendWatchdogAlert] Alert implementation.
 * @returns {Promise<{status: string, restarted: boolean}>} Cycle result.
 */
export const runWatchdogCycle = async ({
    platform,
    url,
    pm2Bin,
    pm2App,
    environmentFile,
    statePath,
    now = Date.now(),
    probe = probeBackend,
    restart = restartBackend,
    alert = sendWatchdogAlert,
} = {}) => {
    const notify = async detail => {
        try {
            await alert({environment, platform, ...detail})
        }
        catch (error) {
            console.error(`[ERROR] Backend watchdog alert failed: ${error.message}`)
        }
    }
    const environment = {
        ...process.env,
        ...parseEnvironmentFile(await readFile(environmentFile, 'utf8')),
    }
    const state = await readWatchdogState(statePath)
    const result = await probe({url})

    if (result.ok) {
        const wasDown = state.outageActive || state.consecutiveFailures > 0
        await writeWatchdogState(statePath, {consecutiveFailures: 0, lastRestartAt: state.lastRestartAt, outageActive: false})
        if (wasDown) {
            await notify({status: 'recovered', detail: 'The liveness endpoint is responding again'})
        }
        return {status: 'healthy', restarted: false}
    }

    const nextState = {
        consecutiveFailures: state.consecutiveFailures + 1,
        lastRestartAt:        state.lastRestartAt,
        outageActive:         true,
    }
    let restarted = false
    if (shouldRestartBackend(nextState, now)) {
        try {
            await restart({pm2Bin, pm2App, environment})
            nextState.lastRestartAt = now
            nextState.consecutiveFailures = 0
            restarted = true
            await notify({status: 'restarted', detail: `Liveness check failed: ${result.reason ?? 'unknown reason'}`})
        }
        catch (error) {
            nextState.lastRestartAt = now
            await notify({status: 'restart-failed', detail: 'The backend remained unavailable and PM2 restart failed'})
            console.error(`[ERROR] Backend watchdog restart failed: ${error.message}`)
        }
    }

    await writeWatchdogState(statePath, nextState)
    return {status: restarted ? 'restarted' : 'unhealthy', restarted}
}

/**
 * Read one command-line option from a watchdog invocation.
 *
 * @param {string[]} argumentsList Command-line arguments.
 * @param {string} name Option name.
 * @returns {string} Option value.
 */
const readOption = (argumentsList, name) => {
    const index = argumentsList.indexOf(name)
    const value = index >= 0 ? argumentsList[index + 1] : undefined
    if (!value || value.startsWith('--')) {
        throw new Error(`Missing watchdog option: ${name}`)
    }
    return value
}

if (import.meta.main) {
    const argumentsList = process.argv.slice(2)
    const statePath = readOption(argumentsList, '--state-path')
    const lockPath = `${statePath}.lock`
    let lockAcquired = false
    acquireLock(lockPath).then(acquired => {
        lockAcquired = acquired
        if (!acquired) {
            return null
        }

        return runWatchdogCycle({
            platform:        readOption(argumentsList, '--platform'),
            url:             readOption(argumentsList, '--url'),
            pm2Bin:          readOption(argumentsList, '--pm2-bin'),
            pm2App:          readOption(argumentsList, '--pm2-app'),
            environmentFile: readOption(argumentsList, '--environment-file'),
            statePath,
        }).then(result => {
            console.log(`[watchdog] ${result.status}`)
        })
    }).catch(error => {
        console.error(`[ERROR] Backend watchdog failed: ${error.message}`)
        process.exitCode = 1
    }).finally(async () => {
        if (lockAcquired) {
            await rm(lockPath, {recursive: true, force: true})
        }
    })
}
