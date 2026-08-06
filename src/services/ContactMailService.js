import nodemailer from 'nodemailer'

const MAX_NAME_LENGTH = 80
const MAX_EMAIL_LENGTH = 254
const MAX_SUBJECT_LENGTH = 160
const MAX_MESSAGE_LENGTH = 5000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
 * @returns {{firstName: string, lastName: string, email: string, subject: string, message: string, consent: true}}
 */
export const normalizeContactMessage = (payload) => {
    if (!isObject(payload)) {
        throw new ContactMailValidationError('Invalid contact payload')
    }

    if (payload.consent !== true) {
        throw new ContactMailValidationError('Consent is required')
    }

    return {
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
    'New message from the LGS1920 contact form',
    '',
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
        this.recipient = env.LGS1920_CONTACT_RECIPIENT || 'studio@lgs1920.fr'
        this.sender = env.LGS1920_CONTACT_FROM || this.recipient
    }

    createTransport = () => {
        const host = this.env.LGS1920_SMTP_HOST?.trim()
        if (!host) {
            throw new ContactMailConfigurationError('Contact email delivery is not configured')
        }

        const port = Number(this.env.LGS1920_SMTP_PORT || 587)
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new ContactMailConfigurationError('Invalid SMTP port')
        }

        const options = {
            host,
            port,
            secure: this.env.LGS1920_SMTP_SECURE === 'true',
        }

        const username = this.env.LGS1920_SMTP_USER?.trim()
        const password = this.env.LGS1920_SMTP_PASSWORD
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
        const transporter = this.transporter ?? this.createTransport()

        try {
            await transporter.sendMail({
                from:    this.sender,
                to:      this.recipient,
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
