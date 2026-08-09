# Form mail delivery specification

## Purpose

This specification defines the two messages sent after a valid contact or
launch-registration submission:

1. a support notification sent to the configured LGS1920 Studio mailbox;
2. a separate acknowledgement sent to the visitor.

The backend applies the same delivery contract to both forms through the
shared form mail service.

## Common data

| Symbol | Source | Meaning |
| --- | --- | --- |
| `visitorName` | `firstName` + `lastName` | Display name in the `From` and `To` headers |
| `visitorEmail` | `email` | Validated visitor email address |
| `supportMailbox` | `LGS1920_CONTACT_TARGET_<KEY>` | Server-side Studio mailbox resolved from the opaque `to` key |
| `supportBody` | `supportRenderedMessage` or backend fallback | Message sent to Studio |
| `acknowledgementBody` | `renderedMessage` or backend fallback | Message sent to the visitor |

The browser sends only the opaque target key. It never supplies the resolved
Studio email address.

## Support notification

The support notification must be sent with the following headers:

```text
From:     <visitorName> <visitorEmail>
To:       <supportMailbox>
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
footer.

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

The body is the site-rendered `renderedMessage` when present. Otherwise the
backend uses the corresponding localized fallback. Registration acknowledgements
must contain a single-use cancellation link generated for that registration.

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

The backend fallback templates live under `messages/forms/`. The site may send
the rendered equivalents through `supportRenderedMessage` and
`renderedMessage`. The supported form placeholders are `{{form}}`,
`{{locale}}`, `{{firstName}}`, `{{lastName}}`, `{{email}}`, `{{subject}}`, and
`{{message}}`. A site-rendered launch-registration acknowledgement may also
use `{{revoke-url}}`.

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

### Launch-registration support notification

Path: `messages/forms/support/launch-registration/en.md`

```markdown
# New LGS1920 Studio launch registration

A visitor has registered for the LGS1920 Studio launch.

## Submitted details

- Form: {{form}}
- Name: {{firstName}} {{lastName}}
- Email: {{email}}

Thank you for your attention to this registration.

Kind regards,

The LGS1920 Studio team
```

Path: `messages/forms/support/launch-registration/fr.md`

```markdown
# Nouvelle inscription au lancement de LGS1920 Studio

Un visiteur s’est inscrit au lancement de LGS1920 Studio.

## Informations transmises

- Formulaire : {{form}}
- Nom : {{firstName}} {{lastName}}
- E-mail : {{email}}

Merci de l’attention portée à cette inscription.

Cordialement,

L’équipe LGS1920 Studio
```

### Launch-registration acknowledgement

Path: `messages/forms/launch-registration/en.md`

```markdown
# Thank you for registering for the LGS1920 Studio launch

Thank you for your interest in LGS1920 Studio. Your registration has been recorded, and we will keep you informed about the launch.

## Registration details

Name: {{firstName}} {{lastName}}
Email: {{email}}

To cancel your registration, please click the link below.

Kind regards,

The LGS1920 Studio team
```

Path: `messages/forms/launch-registration/fr.md`

```markdown
# Merci pour votre inscription au lancement de LGS1920 Studio

Merci de votre intérêt pour LGS1920 Studio. Votre inscription a bien été enregistrée et nous vous tiendrons informé du lancement.

## Détails de l’inscription

Nom : {{firstName}} {{lastName}}
E-mail : {{email}}

Pour annuler votre inscription, veuillez cliquer sur le lien ci-dessous.

Cordialement,

L’équipe LGS1920 Studio
```

For a registration acknowledgement, the backend appends the single-use
cancellation link after the fixed fallback template. A site-rendered
acknowledgement may instead include the `{{revoke-url}}` placeholder; in that
case the backend replaces the placeholder in place.

## Delivery sequence

For each non-honeypot submission:

1. validate the form payload and resolve `supportMailbox` from the target key;
2. prepare the support notification and acknowledgement;
3. send the support notification;
4. send the acknowledgement;
5. return success only after both SMTP operations succeed.

The messages are sent sequentially. If the support notification fails, the
acknowledgement is not attempted. If the acknowledgement fails after the
support notification was accepted, the request reports a delivery failure and
does not automatically resend the support notification.

For launch registration, persistence occurs before mail delivery. A delivery
failure therefore does not silently delete the stored registration.

Honeypot submissions return a successful no-op response and send no messages.

## Failure and security requirements

- Invalid form data returns HTTP `400` without sending a message.
- An unknown target key returns HTTP `400` without sending a message.
- Missing or invalid SMTP configuration returns HTTP `503`.
- SMTP delivery failures return HTTP `503` without exposing provider details.
- SMTP credentials, target mappings, tokens, and raw upstream errors must not be
  logged or returned to the client.
- The SMTP relay must permit the visitor email to appear in the support
  notification `From` header. A relay that rewrites or rejects this identity
  does not satisfy this specification.

## Acceptance criteria

For both `contact` and `launch-registration`, an integration test must verify
that:

- exactly two messages are sent for one valid submission;
- the first message uses `visitorName <visitorEmail>` as `From` and reaches the
  configured Studio mailbox;
- the second message uses `LGS1920 Studio <supportMailbox>` as `From` and reaches
  the visitor;
- the `Reply-To` values are visitor email for the support message and Studio
  mailbox for the acknowledgement;
- localized subjects and rendered/fallback bodies are selected correctly;
- a registration acknowledgement contains its cancellation link;
- malformed, unauthorized, rate-limited, honeypot, and SMTP-failure cases do not
  produce unintended messages.

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
