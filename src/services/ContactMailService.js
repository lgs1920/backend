import nodemailer from 'nodemailer'
import { getContactTargetMap } from '../utils/ContactRequestSecurity.js'

const MAX_NAME_LENGTH = 80
const MAX_EMAIL_LENGTH = 254
const MAX_SUBJECT_LENGTH = 160
const MAX_MESSAGE_LENGTH = 5000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEFAULT_SMTP_CONNECTION_TIMEOUT_MS = 15_000
const DEFAULT_SMTP_GREETING_TIMEOUT_MS = 10_000
const DEFAULT_SMTP_SOCKET_TIMEOUT_MS = 30_000
const MIN_SMTP_TIMEOUT_MS = 1_000
const MAX_SMTP_TIMEOUT_MS = 120_000

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const readText = (value, label, maxLength) => {
    if (typeof value !== 'string') {
        throw new ContactMailValidationError(`${label} is required`)
    }

    const normalized = value.trim()
    if (!normalized || normalized.length > maxLength) {
        throw new ContactMailValidationError(`Invalid ${label}`)
    }

    return normalized
}

const readEmail = (value) => {
    const email = readText(value, 'email address', MAX_EMAIL_LENGTH)
    if (!EMAIL_PATTERN.test(email)) {
        throw new ContactMailValidationError('Invalid email address')
    }
    return email
}

const stripControlCharacters = (value) => value.replace(/[\r\n]+/g, ' ')

/**
 * Read one bounded SMTP timeout from the server environment.
 *
 * @param {*} value Environment value.
 * @param {string} name Environment variable name.
 * @param {number} fallback Default timeout in milliseconds.
 * @returns {number} Validated timeout in milliseconds.
 * @throws {ContactMailConfigurationError} If the timeout is outside safe bounds.
 */
const readSmtpTimeout = (value, name, fallback) => {
    if (value === undefined || value === '') {
        return fallback
    }

    const timeout = Number(value)
    if (!Number.isSafeInteger(timeout) || timeout < MIN_SMTP_TIMEOUT_MS || timeout > MAX_SMTP_TIMEOUT_MS) {
        throw new ContactMailConfigurationError(`${name} must be between ${MIN_SMTP_TIMEOUT_MS} and ${MAX_SMTP_TIMEOUT_MS} milliseconds`)
    }

    return timeout
}

/** Error raised when a contact message does not satisfy the public API contract. */
export class ContactMailValidationError extends Error {
    constructor(message) {
        super(message)
        this.name = 'ContactMailValidationError'
    }
}

/** Error raised when SMTP settings are missing from the backend environment. */
export class ContactMailConfigurationError extends Error {
    constructor(message) {
        super(message)
        this.name = 'ContactMailConfigurationError'
    }
}

/** Error raised when the configured SMTP relay rejects a message. */
export class ContactMailDeliveryError extends Error {
    constructor(message, cause = undefined) {
        super(message, cause ? {cause} : undefined)
        this.name = 'ContactMailDeliveryError'
    }
}

/**
 * Normalize and validate a public contact message.
 *
 * @param {*} payload Raw request body.
 * @returns {{to: string, firstName: string, lastName: string, email: string, subject: string, message: string, consent: true}}
 */
export const normalizeContactMessage = (payload) => {
    if (!isObject(payload)) {
        throw new ContactMailValidationError('Invalid contact payload')
    }

    if (payload.consent !== true) {
        throw new ContactMailValidationError('Consent is required')
    }

    return {
        to:        readText(payload.to, 'contact target', 64),
        firstName: readText(payload.firstName, 'first name', MAX_NAME_LENGTH),
        lastName:  readText(payload.lastName, 'last name', MAX_NAME_LENGTH),
        email:     readEmail(payload.email),
        subject:   stripControlCharacters(readText(payload.subject, 'subject', MAX_SUBJECT_LENGTH)),
        message:   readText(payload.message, 'message', MAX_MESSAGE_LENGTH),
        consent:   true,
    }
}

const isHoneypotFilled = (payload) => isObject(payload)
    && typeof payload.website === 'string'
    && payload.website.trim().length > 0

const buildTextMessage = (contact) => [
    `Name: ${contact.firstName} ${contact.lastName}`,
    `Email: ${contact.email}`,
    `Subject: ${contact.subject}`,
    '',
    contact.message,
].join('\n')

/**
 * Send contact messages through the SMTP relay configured for the backend.
 */
export class ContactMailService {
    /**
     * @param {object} options Service options.
     * @param {object} [options.env=process.env] Environment-like configuration.
     * @param {object} [options.transporter] Injected nodemailer transport for tests.
     */
    constructor({env = process.env, transporter = null} = {}) {
        this.env = env
        this.transporter = transporter
    }

    /**
     * Resolve the contact mailbox selected by the opaque target key.
     *
     * @returns {{recipient: string, sender: string}} Resolved message addresses.
     * @throws {ContactMailConfigurationError} If the target mapping is missing.
     */
    getConfiguredAddresses = (targetKey) => {
        const targets = getContactTargetMap(this.env)
        if (Object.keys(targets).length === 0) {
            throw new ContactMailConfigurationError('Contact target mapping is not configured')
        }

        const key = typeof targetKey === 'string' ? targetKey.trim().toLowerCase() : ''
        const recipient = targets[key]
        if (!recipient) {
            throw new ContactMailValidationError('Invalid contact target')
        }

        return {recipient, sender: recipient}
    }

    /**
     * Create an SMTP transport using the resolved contact address as the login.
     *
     * @param {string} [targetAddress=''] Resolved address selected by the opaque contact key.
     * @returns {object} Configured Nodemailer transport.
     * @throws {ContactMailConfigurationError} If SMTP configuration is invalid.
     */
    createTransport = (targetAddress = '') => {
        const host = this.env.LGS1920_SMTP_HOST?.trim()
        if (!host) {
            throw new ContactMailConfigurationError('Contact email delivery is not configured')
        }

        const port = Number(this.env.LGS1920_SMTP_PORT || 465)
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new ContactMailConfigurationError('Invalid SMTP port')
        }

        const secureValue = this.env.LGS1920_SMTP_SECURE
        if (secureValue !== undefined && !['true', 'false'].includes(secureValue)) {
            throw new ContactMailConfigurationError('Invalid SMTP secure mode')
        }

        const secure = secureValue === undefined ? port === 465 : secureValue === 'true'
        if (port === 465 && !secure) {
            throw new ContactMailConfigurationError('SMTP port 465 requires implicit TLS')
        }

        const options = {
            host,
            port,
            secure,
            requireTLS: !secure,
            tls: {rejectUnauthorized: true},
            connectionTimeout: readSmtpTimeout(this.env.LGS1920_SMTP_CONNECTION_TIMEOUT_MS, 'LGS1920_SMTP_CONNECTION_TIMEOUT_MS', DEFAULT_SMTP_CONNECTION_TIMEOUT_MS),
            greetingTimeout:   readSmtpTimeout(this.env.LGS1920_SMTP_GREETING_TIMEOUT_MS, 'LGS1920_SMTP_GREETING_TIMEOUT_MS', DEFAULT_SMTP_GREETING_TIMEOUT_MS),
            socketTimeout:     readSmtpTimeout(this.env.LGS1920_SMTP_SOCKET_TIMEOUT_MS, 'LGS1920_SMTP_SOCKET_TIMEOUT_MS', DEFAULT_SMTP_SOCKET_TIMEOUT_MS),
        }

        const password = this.env.LGS1920_SMTP_PASSWORD
        const resolvedTargetAddress = typeof targetAddress === 'string' ? targetAddress.trim() : ''
        const configuredUsername = this.env.LGS1920_SMTP_USER?.trim()
        const username = password && resolvedTargetAddress ? resolvedTargetAddress : configuredUsername
        if (username || password) {
            if (!username || !password) {
                throw new ContactMailConfigurationError('SMTP credentials are incomplete')
            }
            options.auth = {user: username, pass: password}
        }

        return nodemailer.createTransport(options)
    }

    /**
     * Send one validated contact message.
     *
     * @param {*} payload Raw public request body.
     * @returns {Promise<{success: boolean, sent: boolean}>} Public-safe result.
     */
    send = async (payload) => {
        if (isHoneypotFilled(payload)) {
            return {success: true, sent: false}
        }

        const contact = normalizeContactMessage(payload)
        const {recipient, sender} = this.getConfiguredAddresses(contact.to)
        const transporter = this.transporter ?? this.createTransport(recipient)

        try {
            await transporter.sendMail({
                from:    {
                    name:    contact.email,
                    address: sender,
                },
                to:      recipient,
                replyTo: contact.email,
                subject: `[LGS1920 Contact] ${contact.subject}`,
                text:    buildTextMessage(contact),
            })
        }
        catch (error) {
            throw new ContactMailDeliveryError('Unable to deliver contact message', error)
        }

        return {success: true, sent: true}
    }
}
