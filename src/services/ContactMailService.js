import nodemailer from 'nodemailer'
import MarkdownIt from 'markdown-it'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import { getContactTargetMap } from '../utils/ContactRequestSecurity.js'
import {normalizeFormMailMetadata} from '../utils/FormMailContract.js'

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

const FORM_SUBJECTS = {
    contact:             '[LGS1920 Contact]',
    'launch-registration': '[LGS1920 Launch Registration]',
}

const PRODUCTION_SITE_PUBLIC_URL = 'https://lgs1920.fr'
const PRODUCTION_LOGO_PATH = '/assets/logo/logo-horizontal.png'
const PRODUCTION_LOGO_URL = `${PRODUCTION_SITE_PUBLIC_URL}${PRODUCTION_LOGO_PATH}`
const PRODUCTION_LOGO_MARKUP = `<img src="${PRODUCTION_LOGO_URL}" alt="LGS1920 Studio">`
const PRODUCTION_LOGO_HTML = `<img src="${PRODUCTION_LOGO_URL}" alt="LGS1920 Studio" height="80" style="height: 80px; width: auto;">`
const SITE_CANCELLATION_ROUTES = {
    en: '/registration/revoke/',
    fr: '/fr/registration/revoke/',
}
const markdownRenderer = new MarkdownIt({html: false, breaks: true, linkify: true})

const normalizePublicOrigin = (value) => {
    if (typeof value !== 'string' || !value.trim()) {
        return null
    }

    try {
        const url = new URL(value.trim())
        if (!['http:', 'https:'].includes(url.protocol)
            || url.pathname !== '/'
            || url.search
            || url.hash
            || url.username
            || url.password) {
            return null
        }

        return url.origin
    }
    catch {
        return null
    }
}

const buildRegistrationCancellationUrl = ({sitePublicUrl, registrationId, cancellationToken, locale}) => {
    const publicOrigin = normalizePublicOrigin(sitePublicUrl)
    if (!publicOrigin || typeof registrationId !== 'string' || !registrationId.trim() || typeof cancellationToken !== 'string' || !cancellationToken.trim()) {
        throw new ContactMailConfigurationError('Registration page URL is not configured')
    }

    const url = new URL(SITE_CANCELLATION_ROUTES[locale === 'fr' ? 'fr' : 'en'], `${publicOrigin}/`)
    url.searchParams.set('id', registrationId.trim())
    url.searchParams.set('token', cancellationToken.trim())
    url.searchParams.set('locale', locale === 'fr' ? 'fr' : 'en')
    return url.toString()
}

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
 * @returns {{form: string, locale: string, renderedMessage: string|null, supportRenderedMessage: string|null, to: string, firstName: string, lastName: string, email: string, subject: string, message: string, consent: true}} Normalized contact message.
 * @throws {ContactMailValidationError} If the message is incomplete or invalid.
 */
export const normalizeContactMessage = (payload) => {
    if (!isObject(payload)) {
        throw new ContactMailValidationError('Invalid contact payload')
    }

    if (payload.consent !== true) {
        throw new ContactMailValidationError('Consent is required')
    }

    let metadata
    try {
        metadata = normalizeFormMailMetadata(payload, {defaultForm: 'contact', expectedForm: 'contact'})
    }
    catch (error) {
        throw new ContactMailValidationError(error.message)
    }

    return {
        ...metadata,
        to:        readText(payload.to, 'contact target', 64),
        firstName: readText(payload.firstName, 'first name', MAX_NAME_LENGTH),
        lastName:  readText(payload.lastName, 'last name', MAX_NAME_LENGTH),
        email:     readEmail(payload.email),
        subject:   stripControlCharacters(readText(payload.subject, 'subject', MAX_SUBJECT_LENGTH)),
        message:   readText(payload.message, 'message', MAX_MESSAGE_LENGTH),
        consent:   true,
    }
}

/**
 * Normalize a launch-registration message for the shared mail transport.
 *
 * @param {*} payload Raw request body.
 * @returns {{form: string, locale: string, renderedMessage: string|null, supportRenderedMessage: string|null, to: string, firstName: string, lastName: string, email: string, subject: string|null, message: string|null, consent: true}} Normalized message.
 * @throws {ContactMailValidationError} If the message is incomplete or invalid.
 */
export const normalizeLaunchRegistrationMessage = (payload) => {
    if (!isObject(payload)) {
        throw new ContactMailValidationError('Invalid launch registration mail payload')
    }
    if (payload.consent !== true) {
        throw new ContactMailValidationError('Consent is required')
    }

    let metadata
    try {
        metadata = normalizeFormMailMetadata(payload, {defaultForm: 'launch-registration', expectedForm: 'launch-registration'})
    }
    catch (error) {
        throw new ContactMailValidationError(error.message)
    }

    const subject = payload.subject === undefined || payload.subject === null || payload.subject === ''
        ? null
        : stripControlCharacters(readText(payload.subject, 'subject', MAX_SUBJECT_LENGTH))
    const message = payload.message === undefined || payload.message === null || payload.message === ''
        ? null
        : readText(payload.message, 'message', MAX_MESSAGE_LENGTH)

    return {
        ...metadata,
        to:        readText(payload.to, 'contact target', 64),
        firstName: readText(payload.firstName, 'first name', MAX_NAME_LENGTH),
        lastName:  readText(payload.lastName, 'last name', MAX_NAME_LENGTH),
        email:     readEmail(payload.email),
        subject,
        message,
        consent:   true,
    }
}

const isHoneypotFilled = (payload) => isObject(payload)
    && typeof payload.website === 'string'
    && payload.website.trim().length > 0

/**
 * Replace the supported form placeholders in one fixed Markdown template.
 *
 * @param {string} template Markdown template loaded from the backend catalog.
 * @param {object} form Normalized form message.
 * @returns {string} Interpolated Markdown content.
 */
const interpolateFormMessage = (template, form) => template
    .replaceAll('{{form}}', form.form)
    .replaceAll('{{locale}}', form.locale)
    .replaceAll('{{firstName}}', form.firstName)
    .replaceAll('{{lastName}}', form.lastName)
    .replaceAll('{{email}}', form.email)
    .replaceAll('{{subject}}', form.subject ?? 'Not provided')
    .replaceAll('{{message}}', form.message ?? 'The form was submitted with the required consent.')

/**
 * Append the shared horizontal logo footer to one mail body.
 *
 * @param {string} message Mail body in Markdown or plain text.
 * @param {string} origin Public site origin used to resolve the logo asset.
 * @returns {string} Mail body with one horizontal logo footer.
 */
const appendLogoFooter = (message, origin) => {
    const publicOrigin = normalizePublicOrigin(origin)
    if (!publicOrigin) {
        throw new ContactMailConfigurationError('Public site URL is not configured')
    }

    const logoMarkdown = `![LGS1920 Studio](${publicOrigin}${PRODUCTION_LOGO_PATH})`
    return message.includes(logoMarkdown)
        ? message
        : `${message.trim()}\n\n---\n\n${logoMarkdown}`
}

/**
 * Append the single-use launch registration cancellation link.
 *
 * @param {string} message Mail body in Markdown.
 * @param {'en'|'fr'} locale Mail locale.
 * @param {string} cancellationUrl Private backend cancellation URL.
 * @returns {string} Mail body with the cancellation link.
 */
const appendCancellationLink = (message, locale, cancellationUrl) => {
    const linkLabel = locale === 'fr'
        ? 'Demander l’annulation de l’inscription'
        : 'Cancel this registration'
    return `${message.trim()}\n\n[${linkLabel}](${cancellationUrl})`
}

/**
 * Replace the client template's single-use registration URL placeholder.
 *
 * @param {string} message Markdown message content.
 * @param {string} locale Message locale.
 * @param {string} cancellationUrl Signed cancellation URL.
 * @returns {string} Message with the cancellation URL applied.
 */
const applyCancellationUrlPlaceholder = (message, locale, cancellationUrl) => message.includes('{{revoke-url}}')
    ? message.replaceAll('{{revoke-url}}', cancellationUrl)
    : appendCancellationLink(message, locale, cancellationUrl)

/**
 * Convert Markdown content to safe HTML for an email body.
 *
 * @param {string} message Markdown message content.
 * @returns {string} HTML email body.
 */
const renderMailHtml = (message) => markdownRenderer.render(message)
    .replaceAll(PRODUCTION_LOGO_MARKUP, PRODUCTION_LOGO_HTML)

/**
 * Load and interpolate the fixed Markdown fallback for a validated form.
 *
 * @param {string} templateDirectory Directory containing one Markdown fallback per locale.
 * @param {object} form Normalized form message.
 * @param {'acknowledgement'|'support'} [audience='acknowledgement'] Template audience.
 * @returns {Promise<string>} Interpolated Markdown message without the shared footer.
 * @throws {ContactMailConfigurationError} If the fallback file is unavailable or invalid.
 */
const loadDefaultFormMessage = async (templateDirectory, form, audience = 'acknowledgement') => {
    let template
    const templatePaths = audience === 'support'
        ? [path.join(templateDirectory, 'support', form.form, `${form.locale}.md`)]
        : [
            path.join(templateDirectory, form.form, `${form.locale}.md`),
            path.join(templateDirectory, `${form.locale}.md`),
        ]
    for (const templatePath of templatePaths) {
        try {
            template = await readFile(templatePath, 'utf8')
            break
        }
        catch {
            // Continue with the legacy locale-only fallback when needed.
        }
    }
    if (!template) {
        throw new ContactMailConfigurationError('Default form message is unavailable')
    }

    const message = interpolateFormMessage(template, form).trim()
    if (!message || message.length > 20_000 || /{{[\s\S]*?}}/.test(message)) {
        throw new ContactMailConfigurationError('Default form message is invalid')
    }

    return message
}

/**
/**
 * Send support notifications and client acknowledgements through the SMTP relay.
 */
export class ContactMailService {
    /**
     * @param {object} options Service options.
     * @param {object} [options.env=process.env] Environment-like configuration.
     * @param {object} [options.transporter] Injected nodemailer transport for tests.
     * @param {string} [options.templateDirectory] Fixed directory containing acknowledgement and support Markdown fallbacks.
     * @param {string} [options.sitePublicUrl] Public site origin used by registration cancellation links.
     * @param {boolean} [options.diagnosticLogging=false] Log safe mail rendering diagnostics.
     */
    constructor({env = process.env, templateDirectory = path.join(process.cwd(), 'messages', 'forms'), transporter = null, sitePublicUrl = undefined, diagnosticLogging = env.LGS1920_MAIL_DIAGNOSTIC_LOG === 'true'} = {}) {
        this.env = env
        this.templateDirectory = templateDirectory
        this.transporter = transporter
        this.sitePublicUrl = sitePublicUrl
        this.logoPublicUrl = PRODUCTION_SITE_PUBLIC_URL
        this.diagnosticLogging = diagnosticLogging
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
     * Send the site-rendered support notification and a separate client acknowledgement.
     *
     * @param {*} payload Raw public request body.
     * @param {object} [options] Transport options.
     * @param {'contact'|'launch-registration'} [options.form='contact'] Form contract to validate.
     * @param {string} [options.registrationId] Stored registration identifier for cancellation links.
     * @param {string} [options.cancellationToken] Single-use registration cancellation token.
     * @returns {Promise<{success: boolean, sent: boolean}>} Public-safe result.
     */
    send = async (payload, {form = 'contact', registrationId = undefined, cancellationToken = undefined} = {}) => {
        if (isHoneypotFilled(payload)) {
            return {success: true, sent: false}
        }

        const contact = form === 'launch-registration'
            ? normalizeLaunchRegistrationMessage(payload)
            : normalizeContactMessage(payload)
        const {recipient, sender} = this.getConfiguredAddresses(contact.to)
        const transporter = this.transporter ?? this.createTransport(recipient)
        const subjectPrefix = FORM_SUBJECTS[contact.form]
        const subject = contact.subject
            ? `${subjectPrefix} ${contact.subject}`
            : `${subjectPrefix} submission`
        const visitorName = stripControlCharacters(`${contact.firstName} ${contact.lastName}`)
        const acknowledgementMessage = contact.renderedMessage
            ? contact.renderedMessage
            : await loadDefaultFormMessage(this.templateDirectory, contact, 'acknowledgement')
        const supportMessage = contact.supportRenderedMessage
            ? contact.supportRenderedMessage
            : await loadDefaultFormMessage(this.templateDirectory, contact, 'support')
        const cancellationUrl = contact.form === 'launch-registration'
            ? buildRegistrationCancellationUrl({
                sitePublicUrl:     this.sitePublicUrl,
                registrationId,
                cancellationToken,
                locale:            contact.locale,
            })
            : null
        const clientMessage = contact.form === 'launch-registration'
            ? applyCancellationUrlPlaceholder(acknowledgementMessage, contact.locale, cancellationUrl)
            : acknowledgementMessage
        const supportText = appendLogoFooter(supportMessage, this.logoPublicUrl)
        const supportHtml = renderMailHtml(supportText)
        const clientText = appendLogoFooter(clientMessage, this.logoPublicUrl)
        const clientHtml = renderMailHtml(clientText)

        if (this.diagnosticLogging) {
            console.log('[contact-mail] prepared', {
                form:                 contact.form,
                locale:               contact.locale,
                source:                contact.renderedMessage ? 'site-rendered' : 'backend-fallback',
                renderedMessageLength: contact.renderedMessage?.length ?? 0,
                textLength:            supportText.length,
                htmlLength:            supportHtml.length,
                clientTextLength:      clientText.length,
                clientHtmlLength:      clientHtml.length,
                logoOrigin:            normalizePublicOrigin(this.logoPublicUrl),
            })
        }

        try {
            await transporter.sendMail({
                from:    {
                    name:    visitorName,
                    address: contact.email,
                },
                to:      {
                    name:    visitorName,
                    address: recipient,
                },
                replyTo: contact.email,
                subject,
                text: supportText,
                html: supportHtml,
            })
            await transporter.sendMail({
                from:    {
                    name:    'LGS1920 Studio',
                    address: sender,
                },
                to:      {
                    name:    visitorName,
                    address: contact.email,
                },
                replyTo: recipient,
                subject: contact.form === 'launch-registration'
                    ? contact.locale === 'fr'
                        ? '[LGS1920] Confirmation de votre inscription'
                        : '[LGS1920] Registration confirmation'
                    : contact.locale === 'fr'
                        ? '[LGS1920] Votre message a bien été reçu'
                        : '[LGS1920] We received your message',
                text: clientText,
                html: clientHtml,
            })
        }
        catch (error) {
            if (this.diagnosticLogging) {
                console.log('[contact-mail] delivery failed', {
                    form:   contact.form,
                    locale: contact.locale,
                })
            }
            throw new ContactMailDeliveryError('Unable to deliver contact message', error)
        }

        if (this.diagnosticLogging) {
            console.log('[contact-mail] accepted by SMTP relay', {
                form:   contact.form,
                locale: contact.locale,
            })
        }

        return {success: true, sent: true}
    }

}
