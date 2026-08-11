# Form mail delivery specification

## Purpose

This specification defines the contact message pair and the staged
launch-registration delivery flow. A valid contact submission sends:

1. a support notification sent to the configured LGS1920 Studio mailbox;
2. a separate acknowledgement sent to the visitor.

An initial launch-registration submission sends only a confirmation request to
the visitor. After the visitor confirms, the backend sends the Studio
notification and the final acknowledgement.

## Common data

| Symbol | Source | Meaning |
| --- | --- | --- |
| `visitorName` | `firstName` + `lastName` | Display name in the visitor `From` and acknowledgement `To` headers |
| `visitorEmail` | `email` | Validated visitor email address |
| `supportMailbox` | `LGS1920_CONTACT_TARGET_<KEY>` | Server-side Studio mailbox resolved from the opaque `to` key |
| `supportBody` | `supportRenderedMessage` or contact fallback | Message sent to Studio; launch-registration bodies always come from the Site |
| `confirmationBody` | Site-rendered `renderedMessage` | Initial or resent launch-registration message; never persisted |
| `acknowledgementBody` | Site-rendered `renderedMessage` or contact fallback | Contact acknowledgement or Site-rendered post-confirmation registration message |

The browser sends only the opaque target key. It never supplies the resolved
Studio email address.

## Support notification

The support notification must be sent with the following headers:

```text
From:     <visitorName> <visitorEmail>
To:       LGS1920 Studio <supportMailbox>
Reply-To: <visitorEmail>
```

For example:

```text
From:     Ada Lovelace <ada@example.com>
To:       LGS1920 Studio <studio@lgs1920.fr>
Reply-To: ada@example.com
```

The display name is built from the validated first and last names. Control
characters are removed before the name is used in an email header.

The subject is:

- contact: `[LGS1920 Contact] <visitor subject>`;
- registration: `[LGS1920 Launch Registration] submission` unless a subject is
  provided.

The body is the site-rendered `supportRenderedMessage` when present. Otherwise
the backend uses the corresponding localized fallback. The backend sends both
Markdown text and an HTML rendering, and appends the LGS1920 Studio logo
footer. For launch registration, the Site sends a fresh support body with the
confirmation request; no backend launch-registration fallback exists.

### Nodemailer example

```js
const visitorName = `${firstName} ${lastName}`.replace(/[\r\n]+/g, ' ')

await transporter.sendMail({
    from: {
        name: visitorName,
        address: visitorEmail,
    },
    to: {
        name: 'LGS1920 Studio',
        address: supportMailbox,
    },
    replyTo: visitorEmail,
    subject: '[LGS1920 Contact] Studio question',
    text: supportText,
    html: supportHtml,
})
```

For a launch registration, the same structure is used with the registration
subject and support body:

```js
await transporter.sendMail({
    from: {
        name: `${firstName} ${lastName}`,
        address: visitorEmail,
    },
    to: supportMailbox,
    replyTo: visitorEmail,
    subject: '[LGS1920 Launch Registration] submission',
    text: supportText,
    html: supportHtml,
})
```

## Launch-registration confirmation request

The initial launch-registration email is sent only to the visitor and must use
the following headers:

```text
From:     LGS1920 Studio <supportMailbox>
To:       <visitorName> <visitorEmail>
Reply-To: <supportMailbox>
```

The localized subjects are:

| Locale | Subject |
| --- | --- |
| English | `[LGS1920] Confirm your registration` |
| French | `[LGS1920] Confirmez votre inscription` |

The body uses the fresh Site-rendered `renderedMessage` supplied with the
initial or resend request. The value is not persisted. The body must contain a
single-use Site URL with the `{{confirm-url}}` placeholder replaced.
The confirmation request does not notify Studio and does not create a
confirmed registration.

## Visitor acknowledgement

The acknowledgement must be sent with the following headers:

```text
From:     LGS1920 Studio <supportMailbox>
To:       <visitorName> <visitorEmail>
Reply-To: <supportMailbox>
```

For example:

```text
From:     LGS1920 Studio <studio@lgs1920.fr>
To:       Ada Lovelace <ada@example.com>
Reply-To: studio@lgs1920.fr
```

The subject is localized:

| Form | English | French |
| --- | --- | --- |
| Contact | `[LGS1920] We received your message` | `[LGS1920] Votre message a bien été reçu` |
| Registration | `[LGS1920] Registration confirmation` | `[LGS1920] Confirmation de votre inscription` |

The body is the fresh Site-rendered `renderedMessage` supplied with the
confirmation request. Contact acknowledgements may use the site-rendered
`renderedMessage` or the contact fallback. Registration acknowledgements must
contain a single-use cancellation link generated for that confirmed
registration.

### Acknowledgement example

```js
await transporter.sendMail({
    from: {
        name: 'LGS1920 Studio',
        address: supportMailbox,
    },
    to: {
        name: visitorName,
        address: visitorEmail,
    },
    replyTo: supportMailbox,
    subject: '[LGS1920] We received your message',
    text: acknowledgementText,
    html: acknowledgementHtml,
})
```

The two operations are intentionally explicit and sequential:

```js
await sendSupportNotification()
await sendAcknowledgement()
```

The request is considered successful only when both calls resolve.

### Complete service example

The following reduced example shows the complete message pair. Production code
must validate the input, resolve the target key server-side, render the bodies,
and handle delivery errors before using this sequence.

```js
const sendFormMessages = async ({
    transporter,
    visitorName,
    visitorEmail,
    supportMailbox,
    subject,
    acknowledgementSubject,
    supportText,
    supportHtml,
    acknowledgementText,
    acknowledgementHtml,
}) => {
    await transporter.sendMail({
        from: {name: visitorName, address: visitorEmail},
        to: {name: 'LGS1920 Studio', address: supportMailbox},
        replyTo: visitorEmail,
        subject,
        text: supportText,
        html: supportHtml,
    })

    await transporter.sendMail({
        from: {name: 'LGS1920 Studio', address: supportMailbox},
        to: {name: visitorName, address: visitorEmail},
        replyTo: supportMailbox,
        subject: acknowledgementSubject,
        text: acknowledgementText,
        html: acknowledgementHtml,
    })
}
```

## Message templates

Contact-only backend fallback templates live under `messages/forms/`. Launch
registration templates live exclusively in the Site catalog and are sent as
transient rendered messages through `supportRenderedMessage` and
`renderedMessage`. The supported form placeholders are `{{form}}`,
`{{locale}}`, `{{firstName}}`, `{{lastName}}`, `{{email}}`, `{{subject}}`, and
`{{message}}`. A pending launch-registration message may use
`{{confirm-url}}`; a final registration acknowledgement may use
`{{revoke-url}}`.

### Contact support notification

Path: `messages/forms/support/contact/en.md`

```markdown
# New LGS1920 contact form submission

The contact form has received a new message.

## Submitted details

- Form: {{form}}
- Name: {{firstName}} {{lastName}}
- Email: {{email}}
- Subject: {{subject}}

Message:
{{message}}

Thank you for your attention to this message.

Kind regards,

The LGS1920 Studio team
```

Path: `messages/forms/support/contact/fr.md`

```markdown
# Nouveau message du formulaire de contact LGS1920

Le formulaire de contact a reçu un nouveau message.

## Informations transmises

- Formulaire : {{form}}
- Nom : {{firstName}} {{lastName}}
- E-mail : {{email}}
- Objet : {{subject}}

Message :
{{message}}

Merci de l’attention portée à ce message.

Cordialement,

L’équipe LGS1920 Studio
```

### Contact acknowledgement

Path: `messages/forms/contact/en.md`

```markdown
# Thank you for contacting LGS1920

Thank you for taking the time to write to us. We have received your message and will get back to you as soon as possible.

## Your request

Name: {{firstName}} {{lastName}}
Email: {{email}}
Subject: {{subject}}

{{message}}

If you did not contact us, please ignore this message.

Kind regards,

The LGS1920 Studio team
```

Path: `messages/forms/contact/fr.md`

```markdown
# Merci d’avoir contacté LGS1920

Merci d’avoir pris le temps de nous écrire. Nous avons bien reçu votre message et nous vous répondrons dès que possible.

## Votre demande

Nom : {{firstName}} {{lastName}}
E-mail : {{email}}
Objet : {{subject}}

{{message}}

Si vous ne nous avez pas contacté, veuillez ne pas tenir compte de ce message.

Cordialement,

L’équipe LGS1920 Studio
```

### Launch-registration Site catalogs

The initial and resend acknowledgement catalogs live in the Site repository at
`src/_includes/form-mail/launch-registration/<locale>.md`. The confirmed
acknowledgement catalogs live at
`src/_includes/form-mail/launch-registration/confirmed/<locale>.md`, and the
confirmed Studio notification catalogs live at
`src/_includes/form-mail/support/launch-registration/confirmed/<locale>.md`.
The Site renders these catalogs before each request. The backend replaces
The backend replaces `{{confirm-url}}` or `{{revoke-url}}` with the corresponding
signed URL and does not append or synthesize mail content.

## Delivery sequence

For each non-honeypot launch-registration submission:

1. validate the form payload and rendered messages;
2. reject a confirmed duplicate or report an existing pending confirmation;
3. resolve `supportMailbox` from the target key;
4. persist a new record in the pending-registration file;
5. send the single confirmation request to the visitor;
6. return `status: "pending"` only after the confirmation email is accepted.

The confirmation request does not notify Studio. If its delivery fails, the
backend removes the pending record before returning the failure, so the visitor
may retry. A resend rotates the stored token, invalidates the previous link,
and is protected by both a per-email cooldown and endpoint rate limit.

When the Site confirmation page handles the confirmation link:

1. call `POST /launch-registration/confirm-details` to validate the token and
   obtain the fields needed for Site rendering without consuming the token;
2. render the final acknowledgement and Studio notification in the Site;
3. call `POST /launch-registration/confirm` with both fresh rendered bodies;
4. consume the confirmation token and move the record to the confirmed file;
5. send the Studio notification and final visitor acknowledgement;
6. return the localized success message and masked email.

The confirmed state is authoritative even if the additional post-confirmation
email is temporarily unavailable; the response includes a warning in that
case.

Honeypot submissions return a successful no-op response and send no messages.

## Failure and security requirements

- Invalid form data returns HTTP `400` without sending a message.
- An unknown target key returns HTTP `400` without sending a message.
- Missing or invalid SMTP configuration returns HTTP `503`.
- Initial confirmation-email delivery failures return HTTP `503` with
  `stored: false`, without exposing provider details.
- SMTP credentials, target mappings, tokens, and raw upstream errors must not be
  logged or returned to the client.
- The SMTP relay must permit the visitor email to appear in the support
  notification `From` header. The SMTP envelope uses the authenticated Studio
  sender so relays do not reject the visitor address as an unauthorised
  `MAIL FROM`. A relay that rewrites or rejects the visible identity does not
  satisfy this specification.

## Acceptance criteria

For contact, an integration test must verify that:

- exactly two messages are sent for one valid submission;
- the first message uses `visitorName <visitorEmail>` as `From` and reaches the
  configured Studio mailbox;
- the second message uses `LGS1920 Studio <supportMailbox>` as `From` and reaches
  the visitor;
- the `Reply-To` values are visitor email for the support message and Studio
  mailbox for the acknowledgement;
- localized subjects and rendered/fallback bodies are selected correctly;
- malformed, unauthorized, rate-limited, honeypot, and SMTP-failure cases do not
  produce unintended messages.

For launch registration, integration tests must verify that:

- one initial submission creates a pending record and sends exactly one
  confirmation email to the visitor;
- the confirmation URL is single-use and moves the record to the confirmed
  file;
- a pending duplicate returns `canResend: true`, and resend rotates the token;
- resend receives and sends fresh Site-rendered confirmation content;
- confirmation returns the masked visitor email;
- the confirmation request receives fresh Site-rendered acknowledgement and
  Studio-notification content, and neither body is persisted;
- post-confirmation notification and acknowledgement contain the correct
  localized content and cancellation link;
- expired, malformed, unauthorized, rate-limited, honeypot, and SMTP-failure
  cases do not create unintended confirmed records.

### Test example

```js
const messages = []
const transporter = {
    sendMail: async message => messages.push(message),
}

await sendFormMessages({
    transporter,
    visitorName: 'Ada Lovelace',
    visitorEmail: 'ada@example.com',
    supportMailbox: 'studio@lgs1920.fr',
    subject: '[LGS1920 Contact] Studio question',
    acknowledgementSubject: '[LGS1920] We received your message',
    supportText: 'New contact message',
    supportHtml: '<p>New contact message</p>',
    acknowledgementText: 'We received your message',
    acknowledgementHtml: '<p>We received your message</p>',
})

expect(messages).toHaveLength(2)
expect(messages[0].from).toEqual({
    name: 'Ada Lovelace',
    address: 'ada@example.com',
})
expect(messages[1].from).toEqual({
    name: 'LGS1920 Studio',
    address: 'studio@lgs1920.fr',
})
```
