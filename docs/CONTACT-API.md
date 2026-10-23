# Public launch registration and contact APIs

The public site exposes the following launch-registration and contact endpoints:

- `POST /launch-registration` validates a request, stores it in
  `data/launch-registrations-pending.json`, and sends one confirmation email to
  the visitor. Confirmed registrations are stored in
  `data/launch-registrations.json`; deployed environments use matching files in
  their backend `shared` directory.
- `POST /launch-registration/confirm` consumes a single-use confirmation token,
  moves the pending record to the confirmed file, and returns the visitor email
  in masked form. The Site confirmation page calls this endpoint after the
  visitor opens the link from the email.
- `POST /launch-registration/confirm-details` validates the same token without
  consuming it and returns the private fields the Site needs to render the
  post-confirmation messages. The response is never cached.
- `POST /launch-registration/resend-confirmation` rotates the token and sends a
  replacement confirmation email for an existing pending address.
- `GET /launch-registration/revoke?id=...&token=...` cancels a registration
  through the single-purpose link included in its confirmation email. The link
  opens a localized Site page, which calls this endpoint and displays the
  cancellation result and the cancelled email address.
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

The normal response is:

```json
{
  "success": true,
  "stored": true,
  "status": "pending",
  "confirmationRequired": true,
  "sent": true
}
```

A filled `website` honeypot is accepted as
`{ "success": true, "stored": false }` without creating a record. A normalized
email address that is already confirmed returns HTTP `409` with
`{ "success": false, "error": "Already registered" }`. An address that is
already pending returns HTTP `409` with `status: "pending"`,
`canResend: true`, and a localized message telling the visitor that a
confirmation email is already pending.

If SMTP rejects the initial confirmation email, the backend removes the
pending record and returns HTTP `503` with `stored: false`. The initial
registration endpoint allows 5 requests per client per 15 minutes. Resend and
confirmation endpoints have separate in-process limits, and all limited
requests return HTTP `429` with a `Retry-After` header.

The request must include the opaque `to` target key used by the contact mail
configuration. The `form` and `locale` fields are required; supported locales
are `en` and `fr`.
The request may include bounded `renderedMessage` and
`supportRenderedMessage` values produced by the site catalogs. The backend
validates both values, converts the confirmation message to safe HTML, and
also provides a Markdown-derived text alternative. For launch registration,
`renderedMessage` and `supportRenderedMessage` are transient Site-rendered
content; neither is persisted in the pending or confirmed registration files.
The initial request, a resend request, and the confirmation request each carry
fresh Site-rendered content. The backend does not provide launch-registration
message templates or fallback files.

The launch-registration rendered message may contain `{{confirm-url}}`; the
backend replaces it with the signed Site confirmation URL. The final
post-confirmation acknowledgement must contain `{{revoke-url}}`; the backend
replaces it with the single-use cancellation URL.

Pending records contain a cryptographically random confirmation token and an
expiration time. Only the SHA-256 hash is persisted; the raw token is included
in the email link and is never returned in an API response. The token is
single-use. A resend invalidates the previous token and starts a new expiry
period. Confirmation links target the configured Site origin.

Successful confirmation returns JSON containing `success: true`,
`status: "confirmed"`, the masked `email`, and the localized message
`Votre inscription est confirmée. Merci !` (or its English equivalent). For
example, `ada@example.com` is returned as `a*a@e*****e.com`. The
`confirm-details` response returns the raw registration fields only to the
holder of the valid confirmation token so the Site can render the final mail;
it is marked `no-store` and is not the confirmation result.

After confirmation, the backend creates a separate cancellation token for the
confirmed record. Only its SHA-256 hash is persisted; the raw token is included
in the final acknowledgement email. Successful cancellation returns JSON
containing `success: true`, the
masked `email` (only the first and last character of the local part and domain
name, with the final domain suffix preserved), and the localized confirmation
`message`. The masked email is returned only after the single-use cancellation
token has been validated.
Production, staging, and test derive that origin from the generated
`servers.json` configuration. Local development uses `http://localhost:8080`.
The backend consumes both confirmation and cancellation tokens exactly once
and does not own the localized Site page content.

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
SMTP delivery, registration confirmation, and registration cancellation. The
backend's legacy Markdown fallbacks apply only to the contact form; launch
registration never loads a backend message template. The Site sends rendered
launch-registration bodies again for resend and post-confirmation delivery.
The logo URL always uses the production site origin `https://lgs1920.fr`, with
the horizontal logo rendered at 80 pixels high.

The Site launch-registration catalogs contain the special `{{confirm-url}}` or
`{{revoke-url}}` placeholder for the relevant delivery stage. The backend only
replaces that signed URL placeholder; unknown placeholders are rejected.
