# Public launch registration and contact APIs

The public site exposes two separate mutation endpoints:

- `POST /launch-registration` stores an explicit Studio launch registration in
  `data/launch-registrations.json` and sends two messages through the shared SMTP
  transport: the site-rendered form content to the configured Studio mailbox,
  then a separate acknowledgement to the submitted email address.
- `GET /launch-registration/revoke?id=...&token=...` cancels a registration
  through the single-purpose link included in its confirmation email. The link
  opens a localized Site page, which calls this endpoint and displays the
  cancellation result.
- `GET /contact/token` issues a short-lived token for an allowed contact form
  origin.
- `POST /contact` validates a contact request and sends the site-rendered form
  content to the configured Studio mailbox plus a separate acknowledgement to
  the submitted email address. Contact messages are not persisted by the backend.

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
If SMTP rejects delivery, the backend rolls back the new registration and
returns HTTP `503` with `stored: false`.
The endpoint allows 5 registration requests per client per 15 minutes; limited
requests return HTTP `429` with a `Retry-After` header.

The request must include the opaque `to` target key used by the contact mail
configuration. The `form` and `locale` fields are required; supported locales
are `en` and `fr`.
The request may include bounded `renderedMessage` and
`supportRenderedMessage` values produced by the site catalogs. The backend
validates both values, converts each Markdown message to safe HTML, and also
provides a Markdown-derived text alternative. `renderedMessage` is sent to the
visitor; `supportRenderedMessage` is sent to Studio. When either value is
absent, the backend loads the corresponding form-specific fallback from
`messages/forms/<audience>/<form>/<locale>.md` (with the existing
`messages/forms/<form>/<locale>.md` files retained for acknowledgement
compatibility). The selected form and locale are part of the request contract.

Each stored registration receives a cryptographically random cancellation token.
Only its SHA-256 hash is persisted; the raw token is included in the email link
and is never returned in the public registration response. The link targets the
configured Site origin and is invalid after the registration is cancelled.
Production, staging, and test derive that origin from the generated
`servers.json` configuration. Local development uses `http://localhost:8080`.
The backend consumes the token exactly once and does not own the localized
cancellation page content.

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
  "supportRenderedMessage": "New contact form submission\n...",
  "consent": true,
  "website": ""
}
```

The client must first call `GET /contact/token` with its exact `Origin` header,
then submit the returned token in `csrfToken`. The backend accepts only exact
origins from `LGS1920_ALLOWED_ORIGINS` or the platform defaults. The `to` value
is an opaque key resolved by the backend; raw recipient email addresses are
never accepted from the browser.

The shared email footer always links to the horizontal production logo at
`https://lgs1920.fr/assets/logo/logo-horizontal.png`. The HTML image height is
fixed at 80 pixels, regardless of the backend deployment environment.

The `form` and `locale` values identify the site catalog entries; the backend
accepts only `contact` and the `en`/`fr` locales. `renderedMessage` is the
acknowledgement template for the visitor and `supportRenderedMessage` is the
notification template for Studio. Both are optional, limited to 20,000
characters, and must not contain unresolved `{{...}}` placeholders or control
characters. They are never interpreted as template paths and are each converted
to HTML with a plain-text alternative. The response is `{ "success": true, "sent": true }`
after the SMTP relay accepts both messages. A filled `website` honeypot is accepted as
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
LGS1920_BACKEND_PUBLIC_URL=https://api.lgs1920.fr
LGS1920_MAIL_DIAGNOSTIC_LOG=false
```

When `LGS1920_SMTP_PASSWORD` is configured, the email resolved from the
contact target key is used as the SMTP login. `LGS1920_SMTP_USER` remains an
optional legacy fallback when no resolved target address is passed. Omit both
credentials when the relay explicitly allows unauthenticated delivery. Never
expose these values to the browser or commit them to the repository.
The support notification is sent to the resolved target address with the
visitor's first and last name and email as its `From` identity. The separate
acknowledgement is sent from `LGS1920 Studio <resolved-target-address>` to the
visitor. The resolved target address remains the SMTP login when a password is
configured. `LGS1920_CONTACT_CSRF_SECRET` and the `LGS1920_CONTACT_TARGET_*`
values are server-only configuration. The target key may be included in the
frontend request, but it does not reveal the resolved address.

## Ownership split

The site owns and renders separate localized Markdown catalogs for the visitor
acknowledgement and the Studio notification before calling the backend. The
backend owns form metadata validation, opaque target resolution, rate limiting,
SMTP delivery, form-specific Markdown fallbacks, and registration cancellation.
The client never supplies a template path; only the validated form and locale
select fallback files.
The logo URL always uses the production site origin `https://lgs1920.fr`, with
the horizontal logo rendered at 80 pixels high.
Set `LGS1920_MAIL_DIAGNOSTIC_LOG=true` temporarily to log the selected form,
locale, template source, logo origin, and content sizes without logging
personal data or secrets.

The visitor acknowledgement template for launch registration may contain the
special `{{revoke-url}}` placeholder. The backend replaces it with the
single-use signed cancellation URL after storing the registration. Unknown
placeholders are rejected.
