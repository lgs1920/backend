# Public launch registration and contact APIs

The public site exposes two separate mutation endpoints:

- `POST /launch-registration` stores an explicit Studio launch registration in
  `data/launch-registrations.json`.
- `GET /contact/token` issues a short-lived token for an allowed contact form
  origin.
- `POST /contact` validates a contact request and sends it through the
  configured SMTP relay. Contact messages are not persisted by the backend.

## Launch registration

```json
{
  "to": "f7a91c",
  "csrfToken": "short-lived-token-issued-by-the-backend",
  "firstName": "Ada",
  "lastName": "Lovelace",
  "email": "ada@example.com",
  "consent": true,
  "website": ""
}
```

The response is either `{ "success": true, "stored": true }` or a public-safe
validation/storage error. A filled `website` honeypot is accepted as
`{ "success": true, "stored": false }` without persistence.

## Contact message

```json
{
  "to": "f7a91c",
  "csrfToken": "short-lived-token-issued-by-the-backend",
  "firstName": "Ada",
  "lastName": "Lovelace",
  "email": "ada@example.com",
  "subject": "Studio question",
  "message": "I would like to know more about Studio.",
  "consent": true,
  "website": ""
}
```

The client must first call `GET /contact/token` with its exact `Origin` header,
then submit the returned token in `csrfToken`. The backend accepts only exact
origins from `LGS1920_ALLOWED_ORIGINS` or the platform defaults. The `to` value
is an opaque key resolved by the backend; raw recipient email addresses are
never accepted from the browser.

The response is `{ "success": true, "sent": true }` after the SMTP relay
accepts the message. A filled `website` honeypot is accepted as
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
LGS1920_SMTP_USER=...
LGS1920_SMTP_PASSWORD=...
LGS1920_CONTACT_FROM=your-nuxit-mailbox@example.org
LGS1920_CONTACT_CSRF_SECRET=at-least-32-random-characters
LGS1920_CONTACT_TARGET_F7A91C=your-recipient@example.org
```

`LGS1920_SMTP_USER` and `LGS1920_SMTP_PASSWORD` may both be omitted when the
relay is configured without authentication. Never expose these values to the
browser or commit them to the repository. `LGS1920_CONTACT_CSRF_SECRET` and
the `LGS1920_CONTACT_TARGET_*` values are server-only configuration. The
target key may be included in the frontend request, but it does not reveal the
resolved recipient address.
