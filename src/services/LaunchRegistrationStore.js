import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {normalizeFormMailMetadata} from '../utils/FormMailContract.js'

export const LAUNCH_REGISTRATION_DATA_PATH = path.join('data', 'launch-registrations.json')
export const LAUNCH_REGISTRATION_SCHEMA_VERSION = 2

const MAX_NAME_LENGTH = 80
const MAX_EMAIL_LENGTH = 254
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CANCELLATION_TOKEN_BYTES = 32
const CANCELLATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/

/**
 * Error raised when a launch registration does not satisfy the public API contract.
 */
export class LaunchRegistrationValidationError extends Error {
    /**
     * Create a launch registration validation error.
     *
     * @param {string} message Human-readable validation message.
     */
    constructor(message) {
        super(message)
        this.name = 'LaunchRegistrationValidationError'
    }
}

/**
 * Error raised when a normalized email is already registered for the launch.
 */
export class LaunchRegistrationDuplicateError extends Error {
    /**
     * Create a duplicate launch registration error.
     */
    constructor() {
        super('Launch registration already exists')
        this.name = 'LaunchRegistrationDuplicateError'
    }
}

/**
 * Error raised when launch registration data cannot be safely read or written.
 */
export class LaunchRegistrationStorageError extends Error {
    /**
     * Create a launch registration storage error.
     *
     * @param {string} message Human-readable storage message.
     * @param {*} [cause] Original storage error.
     */
    constructor(message, cause = undefined) {
        super(message, {cause})
        this.name = 'LaunchRegistrationStorageError'
    }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const readName = (value, label) => {
    if (typeof value !== 'string') {
        throw new LaunchRegistrationValidationError(`Invalid ${label}`)
    }

    const name = value.trim()
    if (!name || name.length > MAX_NAME_LENGTH) {
        throw new LaunchRegistrationValidationError(`Invalid ${label}`)
    }

    return name
}

const readEmail = (value) => {
    if (typeof value !== 'string') {
        throw new LaunchRegistrationValidationError('Invalid email address')
    }

    const email = value.trim().toLowerCase()
    if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
        throw new LaunchRegistrationValidationError('Invalid email address')
    }

    return email
}

/**
 * Normalize and validate a launch registration received from the public site.
 *
 * @param {*} payload JSON request body.
 * @returns {{firstName: string, lastName: string, email: string, consent: boolean}} Normalized registration.
 * @throws {LaunchRegistrationValidationError} If the payload is incomplete or invalid.
 */
export const normalizeLaunchRegistrationPayload = (payload) => {
    if (!isObject(payload)) {
        throw new LaunchRegistrationValidationError('Invalid launch registration payload')
    }

    if (payload.consent !== true) {
        throw new LaunchRegistrationValidationError('Consent is required')
    }

    try {
        normalizeFormMailMetadata(payload, {defaultForm: 'launch-registration', expectedForm: 'launch-registration'})
    }
    catch (error) {
        throw new LaunchRegistrationValidationError(error.message)
    }

    return {
        firstName: readName(payload.firstName, 'first name'),
        lastName:  readName(payload.lastName, 'last name'),
        email:     readEmail(payload.email),
        consent:   true,
    }
}

const isHoneypotFilled = (payload) => isObject(payload)
    && typeof payload.website === 'string'
    && payload.website.trim().length > 0

const createCancellationToken = () => randomBytes(CANCELLATION_TOKEN_BYTES).toString('base64url')

const hashCancellationToken = (token) => createHash('sha256').update(token).digest()

const cancellationTokensMatch = (storedHash, token) => {
    if (typeof storedHash !== 'string' || !CANCELLATION_TOKEN_PATTERN.test(token)) {
        return false
    }

    let storedBytes
    try {
        storedBytes = Buffer.from(storedHash, 'hex')
    }
    catch {
        return false
    }

    const receivedBytes = hashCancellationToken(token)
    return storedBytes.length === receivedBytes.length && timingSafeEqual(storedBytes, receivedBytes)
}

/**
 * Create and persist launch registrations in one process-safe FIFO queue.
 */
export class LaunchRegistrationStore {
    /**
     * Create a launch registration store.
     *
     * @param {object} options Store configuration.
     * @param {string} [options.backendHome] Backend home directory.
     * @param {string} [options.filePath] Explicit JSON storage path for tests or deployment overrides.
     * @param {() => Date} [options.clock] Clock used to create deterministic timestamps.
     */
    constructor({
                    backendHome = process.env.LGS1920_BACKEND_HOME || process.cwd(),
                    filePath = undefined,
                    clock = () => new Date(),
                } = {}) {
        this.backendHome = path.resolve(backendHome)
        this.filePath = path.resolve(filePath ?? path.join(this.backendHome, LAUNCH_REGISTRATION_DATA_PATH))
        this.clock = clock
        this.registrations = []
        this.registrationEmails = new Set()
        this.mutationQueue = Promise.resolve()
        this.fileRevision = null
        this.ready = this.load()
    }

    /**
     * Load the existing launch registration file without exposing its contents through the API.
     *
     * @returns {Promise<void>} Completion promise.
     * @throws {LaunchRegistrationStorageError} If an existing file is malformed or unreadable.
     */
    load = async () => {
        await mkdir(path.dirname(this.filePath), {recursive: true})
        this.registrations = []
        this.registrationEmails = new Set()

        try {
            const content = await readFile(this.filePath, 'utf8')
            const persisted = JSON.parse(content)
            if (!isObject(persisted) || ![1, LAUNCH_REGISTRATION_SCHEMA_VERSION].includes(persisted.schemaVersion) || !Array.isArray(persisted.registrations)) {
                throw new Error('Invalid launch registration file shape')
            }
            this.registrations = persisted.registrations
            this.registrationEmails = new Set(this.registrations
                .map(registration => typeof registration?.email === 'string' ? registration.email.trim().toLowerCase() : null)
                .filter(Boolean))
            this.fileRevision = createHash('sha256').update(content).digest('hex')
        }
        catch (error) {
            if (error?.code === 'ENOENT') {
                this.fileRevision = null
                return
            }
            throw new LaunchRegistrationStorageError('Unable to read launch registration data', error)
        }
    }

    /**
     * Reload registration data and report whether the file changed externally.
     *
     * @returns {Promise<boolean>} Whether the persisted file revision changed.
     */
    refresh = async () => {
        await this.ready
        const previousRevision = this.fileRevision
        await this.load()
        return previousRevision !== this.fileRevision
    }

    /**
     * Check whether a normalized email already has a launch registration.
     *
     * @param {*} email Email address to check.
     * @returns {Promise<boolean>} Whether the email is already registered.
     */
    hasRegistration = async (email) => {
        await this.refresh()
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
        return Boolean(normalizedEmail && this.registrationEmails.has(normalizedEmail))
    }

    /**
     * Append one accepted registration to the JSON file atomically.
     *
     * @param {*} payload Raw public request body.
     * @returns {Promise<{success: boolean, stored: boolean}>} Public-safe result.
     */
    register = (payload) => {
        const operation = this.mutationQueue.then(async () => {
            await this.refresh()

            if (isHoneypotFilled(payload)) {
                return {success: true, stored: false}
            }

            const registration = normalizeLaunchRegistrationPayload(payload)
            if (this.registrationEmails.has(registration.email)) {
                throw new LaunchRegistrationDuplicateError()
            }

            const consentAt = this.clock().toISOString()
            const cancellationToken = createCancellationToken()
            this.registrations.push({
                id:             randomUUID(),
                createdAt:      consentAt,
                consentAt,
                consentPurpose:'studio-launch',
                cancellationTokenHash: hashCancellationToken(cancellationToken).toString('hex'),
                mailTarget:     typeof payload?.to === 'string' && payload.to.trim()
                    ? payload.to.trim().toLowerCase()
                    : null,
                ...registration,
            })
            this.registrationEmails.add(registration.email)
            await this.save()

            return {
                success: true,
                stored: true,
                id: this.registrations.at(-1).id,
                cancellationToken,
            }
        })

        this.mutationQueue = operation.catch(() => undefined)
        return operation
    }

    /**
     * Remove one persisted registration after a delivery failure.
     *
     * @param {string} id Registration identifier to remove.
     * @returns {Promise<boolean>} Whether the registration was removed.
     * @throws {LaunchRegistrationStorageError} If persistence fails.
     */
    removeRegistration = (id) => {
        const operation = this.mutationQueue.then(async () => {
            await this.refresh()

            const registrationIndex = this.registrations.findIndex(registration => registration?.id === id)
            if (registrationIndex < 0) {
                return false
            }

            const [registration] = this.registrations.splice(registrationIndex, 1)
            this.registrationEmails.delete(registration.email.trim().toLowerCase())
            await this.save()
            return true
        })

        this.mutationQueue = operation.catch(() => undefined)
        return operation
    }

    /**
     * Revoke one launch registration with its single-purpose email token.
     *
     * @param {*} id Stored registration identifier.
     * @param {*} token Raw cancellation token from the email link.
     * @returns {Promise<{firstName: string, email: string, mailTarget: string|null}|null>} Removed registration mail details, or null when no matching registration exists.
     * @throws {LaunchRegistrationStorageError} If persistence fails.
     */
    revoke = (id, token) => {
        const operation = this.mutationQueue.then(async () => {
            await this.refresh()

            if (typeof id !== 'string' || !id.trim() || typeof token !== 'string') {
                return false
            }

            const registrationIndex = this.registrations.findIndex(registration => registration?.id === id.trim())
            if (registrationIndex < 0 || !cancellationTokensMatch(this.registrations[registrationIndex].cancellationTokenHash, token)) {
                return false
            }

            const [registration] = this.registrations.splice(registrationIndex, 1)
            this.registrationEmails.delete(registration.email.trim().toLowerCase())
            await this.save()
            return true
        })

        this.mutationQueue = operation.catch(() => undefined)
        return operation
    }

    /**
     * Persist the current launch registration list through a temporary file and rename.
     *
     * @returns {Promise<void>} Completion promise.
     * @throws {LaunchRegistrationStorageError} If persistence fails.
     */
    save = async () => {
        const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
        const payload = JSON.stringify({
            schemaVersion: LAUNCH_REGISTRATION_SCHEMA_VERSION,
            registrations: this.registrations,
        }, null, 2)

        try {
            await writeFile(temporaryPath, `${payload}\n`, {encoding: 'utf8', mode: 0o600})
            await rename(temporaryPath, this.filePath)
            this.fileRevision = createHash('sha256').update(`${payload}\n`).digest('hex')
        }
        catch (error) {
            await rm(temporaryPath, {force: true}).catch(() => undefined)
            throw new LaunchRegistrationStorageError('Unable to save launch registration data', error)
        }
    }
}
