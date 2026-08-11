export const FORM_MAIL_FORMS = Object.freeze(['contact', 'launch-registration'])
export const FORM_MAIL_LOCALES = Object.freeze(['en', 'fr'])
export const MAX_RENDERED_MESSAGE_LENGTH = 20_000

const FORM_PATTERN = /^[a-z][a-z0-9-]{1,31}$/
const LOCALE_PATTERN = /^[a-z]{2}(?:-[a-z]{2})?$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const UNRESOLVED_PLACEHOLDER_PATTERN = /{{[\s\S]*?}}/
const REVOKE_URL_PLACEHOLDER = '{{revoke-url}}'
const CONFIRM_URL_PLACEHOLDER = '{{confirm-url}}'
const REGISTRATION_URL_PLACEHOLDERS = new Set([REVOKE_URL_PLACEHOLDER, CONFIRM_URL_PLACEHOLDER])

/**
 * Normalize and validate form metadata shared by browser form mail requests.
 *
 * @param {*} payload Raw request body.
 * @param {object} options Validation options.
 * @param {string} options.defaultForm Form used when legacy clients omit the identifier.
 * @param {string} [options.expectedForm] Form required by the receiving endpoint.
 * @returns {{form: string, locale: string, renderedMessage: string|null, supportRenderedMessage: string|null}} Normalized metadata.
 * @throws {Error} If metadata is unsupported or the rendered message is unsafe or oversized.
 */
export const normalizeFormMailMetadata = (payload, {defaultForm, expectedForm = undefined} = {}) => {
    const requestedForm = payload?.form === undefined ? defaultForm : payload.form
    if (typeof requestedForm !== 'string' || !FORM_PATTERN.test(requestedForm.trim().toLowerCase())) {
        throw new Error('Invalid form identifier')
    }

    const form = requestedForm.trim().toLowerCase()
    if (!FORM_MAIL_FORMS.includes(form) || (expectedForm && form !== expectedForm)) {
        throw new Error('Unsupported form identifier')
    }

    const requestedLocale = payload?.locale
    if (requestedLocale === undefined) {
        throw new Error('Form locale is required')
    }
    if (typeof requestedLocale !== 'string' || !LOCALE_PATTERN.test(requestedLocale.trim().toLowerCase())) {
        throw new Error('Invalid form locale')
    }

    const locale = requestedLocale.trim().toLowerCase().split('-')[0]
    if (!FORM_MAIL_LOCALES.includes(locale)) {
        throw new Error('Unsupported form locale')
    }

    /**
     * Validate one rendered message supplied by the site.
     *
     * @param {*} value Raw rendered message.
     * @param {object} [options] Validation options.
     * @param {boolean} [options.allowRevokeUrl=false] Allow launch registration URL placeholders for backwards compatibility.
     * @param {boolean} [options.allowRegistrationUrl=false] Allow launch registration confirmation and cancellation URL placeholders.
     * @returns {string|null} Bounded rendered message or null when omitted.
     * @throws {Error} If the rendered message is invalid.
     */
    const normalizeRenderedMessage = (value, {allowRevokeUrl = false, allowRegistrationUrl = false} = {}) => {
        if (value === undefined || value === null || value === '') {
            return null
        }
        if (typeof value !== 'string') {
            throw new Error('Invalid rendered form message')
        }

        const renderedMessage = value.trim()
        if (!renderedMessage || renderedMessage.length > MAX_RENDERED_MESSAGE_LENGTH) {
            throw new Error('Invalid rendered form message')
        }
        const unresolvedPlaceholders = renderedMessage.match(new RegExp(UNRESOLVED_PLACEHOLDER_PATTERN.source, 'g')) ?? []
        const onlyAllowedLaunchPlaceholder = (allowRevokeUrl || allowRegistrationUrl) && form === 'launch-registration'
            && unresolvedPlaceholders.length > 0
            && unresolvedPlaceholders.every(placeholder => REGISTRATION_URL_PLACEHOLDERS.has(placeholder))
        if (CONTROL_CHARACTER_PATTERN.test(renderedMessage) || (UNRESOLVED_PLACEHOLDER_PATTERN.test(renderedMessage) && !onlyAllowedLaunchPlaceholder)) {
            throw new Error('Invalid rendered form message')
        }

        return renderedMessage
    }

    return {
        form,
        locale,
        renderedMessage:        normalizeRenderedMessage(payload?.renderedMessage, {allowRevokeUrl: true}),
        supportRenderedMessage: normalizeRenderedMessage(payload?.supportRenderedMessage),
    }
}
