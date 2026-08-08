# Public launch registration and contact APIs

The public site exposes two separate mutation endpoints:

- `POST /launch-registration` stores an explicit Studio launch registration in
  `data/launch-registrations.json` and can optionally send its rendered form
  message through the shared SMTP transport.
- `GET /contact/token` issues a short-lived token for an allowed contact form
  origin.
- `POST /contact` validates a contact request and sends it through the
  configured SMTP relay. Contact messages are not persisted by the backend.

## Launch registration

```json
{
  "form": "launch-registration",
  "locale": "en",
  "firstName": "Ada",
  "lastName": "Lovelace",
  "email": "ada@example.com",
  "consent": true,
  "website": ""
}
```

The response is either `{ "success": true, "stored": true }` or a public-safe
validation/storage error. A filled `website` honeypot is accepted as
`{ "success": true, "stored": false }` without creating a record. A normalized
email address that is already registered returns HTTP `409` with
`{ "success": false, "error": "Already registered" }`.
The endpoint allows 5 registration requests per client per 15 minutes; limited
requests return HTTP `429` with a `Retry-After` header.

When `LGS1920_LAUNCH_REGISTRATION_EMAIL_ENABLED=true`, the request must also
include the opaque `to` target key used by the contact mail configuration. The
`form` and `locale` fields are required; supported locales are `en` and `fr`.
The request may include a bounded `renderedMessage` produced by the site catalog. The
backend validates the metadata, converts the Markdown content to safe HTML for
the email body, and also provides the Markdown-derived text alternative.
When `renderedMessage` is absent, it loads the shared fixed Markdown fallback
from `messages/forms/<locale>.md`. The same fallback is used for every form;
the selected locale is part of the request contract.

## Contact message

```json
{
  "to": "f7a91c",
  "form": "contact",
  "locale": "en",
  "csrfToken": "short-lived-token-issued-by-the-backend",
  "firstName": "Ada",
  "lastName": "Lovelace",
  "email": "ada@example.com",
  "subject": "Studio question",
  "message": "I would like to know more about Studio.",
  "renderedMessage": "Name: Ada Lovelace\n...",
  "consent": true,
  "website": ""
}
```

The client must first call `GET /contact/token` with its exact `Origin` header,
then submit the returned token in `csrfToken`. The backend accepts only exact
origins from `LGS1920_ALLOWED_ORIGINS` or the platform defaults. The `to` value
is an opaque key resolved by the backend; raw recipient email addresses are
never accepted from the browser.

The `form` and `locale` values identify the site catalog entry; the backend
accepts only `contact` and the `en`/`fr` locales. `renderedMessage` is optional,
limited to 20,000 characters, and must not contain unresolved `{{...}}`
placeholders or control characters. It is never interpreted as a template path
and is converted to HTML with a plain-text alternative. The response is `{ "success": true, "sent": true }`
after the SMTP relay accepts the message. A filled `website` honeypot is accepted as
`{ "success": true, "sent": false }` without sending. An unknown target,
invalid origin, or invalid token is rejected without sending. Missing SMTP or
CSRF configuration or a relay failure returns HTTP 503 without exposing
provider details. The token endpoint allows 10 requests per client per 15
minutes, and the send endpoint allows 5 requests per client per 15 minutes;
limited requests return HTTP 429 with a `Retry-After` header.

Configure the server-side mail relay with:

```dotenv
LGS1920_SMTP_HOST=smtp.webmo.fr
LGS1920_SMTP_PORT=465
LGS1920_SMTP_SECURE=true
LGS1920_SMTP_PASSWORD=...
LGS1920_CONTACT_CSRF_SECRET=at-least-32-random-characters
LGS1920_CONTACT_TARGET_F7A91C=your-recipient@example.org
LGS1920_LAUNCH_REGISTRATION_EMAIL_ENABLED=false
```

When `LGS1920_SMTP_PASSWORD` is configured, the email resolved from the
contact target key is used as the SMTP login. `LGS1920_SMTP_USER` remains an
optional legacy fallback when no resolved target address is passed. Omit both
credentials when the relay explicitly allows unauthenticated delivery. Never
expose these values to the browser or commit them to the repository.
The resolved target address is used as the authenticated SMTP sender and
recipient. The visitor's email is displayed as the sender name and is also
sent as `Reply-To`, so mailbox replies go directly to the visitor without
spoofing the SMTP sender address. `LGS1920_CONTACT_CSRF_SECRET` and the
`LGS1920_CONTACT_TARGET_*` values are server-only configuration. The target
key may be included in the frontend request, but it does not reveal the
resolved address.

## Ownership split

The site may own and render localized Markdown catalogs before calling the
backend. The backend owns form metadata validation, opaque target resolution,
rate limiting, SMTP delivery, and one shared Markdown fallback per supported
locale in `messages/forms/`. The client never supplies a template path; only
the validated locale selects a fallback file.
