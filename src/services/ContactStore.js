import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const REGISTRATION_DATA_PATH = path.join('data', 'launch-registrations.json')
export const REGISTRATION_SCHEMA_VERSION = 1

const MAX_NAME_LENGTH = 80
const MAX_EMAIL_LENGTH = 254
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Error raised when a launch registration does not satisfy the public API contract.
 */
export class ContactValidationError extends Error {
    /**
     * Create a contact validation error.
     *
     * @param {string} message Human-readable validation message.
     */
    constructor(message) {
        super(message)
        this.name = 'ContactValidationError'
    }
}

/**
 * Error raised when launch registration data cannot be safely read or written.
 */
export class ContactStorageError extends Error {
    /**
     * Create a contact storage error.
     *
     * @param {string} message Human-readable storage message.
     * @param {*} [cause] Original storage error.
     */
    constructor(message, cause = undefined) {
        super(message, {cause})
        this.name = 'ContactStorageError'
    }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const readName = (value, label) => {
    if (typeof value !== 'string') {
        throw new ContactValidationError(`Invalid ${label}`)
    }

    const name = value.trim()
    if (!name || name.length > MAX_NAME_LENGTH) {
        throw new ContactValidationError(`Invalid ${label}`)
    }

    return name
}

const readEmail = (value) => {
    if (typeof value !== 'string') {
        throw new ContactValidationError('Invalid email address')
    }

    const email = value.trim().toLowerCase()
    if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
        throw new ContactValidationError('Invalid email address')
    }

    return email
}

/**
 * Normalize and validate a launch registration received from the public site.
 *
 * @param {*} payload JSON request body.
 * @returns {{firstName: string, lastName: string, email: string, consent: boolean}} Normalized registration.
 * @throws {ContactValidationError} If the payload is incomplete or invalid.
 */
export const normalizeContactPayload = (payload) => {
    if (!isObject(payload)) {
        throw new ContactValidationError('Invalid contact payload')
    }

    if (payload.consent !== true) {
        throw new ContactValidationError('Consent is required')
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

/**
 * Create and persist launch registrations in one process-safe FIFO queue.
 */
export class ContactStore {
    /**
     * Create a contact store.
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
        this.filePath = path.resolve(filePath ?? path.join(this.backendHome, REGISTRATION_DATA_PATH))
        this.clock = clock
        this.contacts = []
        this.mutationQueue = Promise.resolve()
        this.ready = this.load()
    }

    /**
     * Load the existing contact file without exposing its contents through the API.
     *
     * @returns {Promise<void>} Completion promise.
     * @throws {ContactStorageError} If an existing file is malformed or unreadable.
     */
    load = async () => {
        await mkdir(path.dirname(this.filePath), {recursive: true})

        try {
            const persisted = JSON.parse(await readFile(this.filePath, 'utf8'))
            if (!isObject(persisted) || persisted.schemaVersion !== REGISTRATION_SCHEMA_VERSION || !Array.isArray(persisted.registrations)) {
                throw new Error('Invalid contact file shape')
            }
            this.contacts = persisted.registrations
        }
        catch (error) {
            if (error?.code === 'ENOENT') {
                return
            }
            throw new ContactStorageError('Unable to read launch registration data', error)
        }
    }

    /**
     * Append one accepted registration to the JSON file atomically.
     *
     * @param {*} payload Raw public request body.
     * @returns {Promise<{success: boolean, stored: boolean}>} Public-safe result.
     */
    create = (payload) => {
        const operation = this.mutationQueue.then(async () => {
            await this.ready

            if (isHoneypotFilled(payload)) {
                return {success: true, stored: false}
            }

            const contact = normalizeContactPayload(payload)
            const consentAt = this.clock().toISOString()
            this.contacts.push({
                id:             randomUUID(),
                createdAt:      consentAt,
                consentAt,
                consentPurpose:'studio-launch',
                ...contact,
            })
            await this.save()

            return {success: true, stored: true}
        })

        this.mutationQueue = operation.catch(() => undefined)
        return operation
    }

    /**
     * Persist the current contact list through a temporary file and rename.
     *
     * @returns {Promise<void>} Completion promise.
     * @throws {ContactStorageError} If persistence fails.
     */
    save = async () => {
        const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
        const payload = JSON.stringify({
            schemaVersion: REGISTRATION_SCHEMA_VERSION,
            registrations: this.contacts,
        }, null, 2)

        try {
            await writeFile(temporaryPath, `${payload}\n`, {encoding: 'utf8', mode: 0o600})
            await rename(temporaryPath, this.filePath)
        }
        catch (error) {
            await rm(temporaryPath, {force: true}).catch(() => undefined)
            throw new ContactStorageError('Unable to save launch registration data', error)
        }
    }
}
