# Public launch registration and contact APIs

The public site exposes two separate mutation endpoints:

- `POST /launch-registration` stores an explicit Studio launch registration in
  `data/launch-registrations.json`.
- `POST /contact` validates a contact request and sends it through the
  configured SMTP relay. Contact messages are not persisted by the backend.

## Launch registration

```json
{
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
  "firstName": "Ada",
  "lastName": "Lovelace",
  "email": "ada@example.com",
  "subject": "Studio question",
  "message": "I would like to know more about Studio.",
  "consent": true,
  "website": ""
}
```

The response is `{ "success": true, "sent": true }` after the SMTP relay
accepts the message. A filled `website` honeypot is accepted as
`{ "success": true, "sent": false }` without sending. Missing SMTP
configuration or a relay failure returns HTTP 503 without exposing provider
details.

Configure the server-side mail relay with:

```dotenv
LGS1920_SMTP_HOST=smtp.example.org
LGS1920_SMTP_PORT=587
LGS1920_SMTP_SECURE=false
LGS1920_SMTP_USER=...
LGS1920_SMTP_PASSWORD=...
LGS1920_CONTACT_RECIPIENT=studio@lgs1920.fr
LGS1920_CONTACT_FROM=studio@lgs1920.fr
```

`LGS1920_SMTP_USER` and `LGS1920_SMTP_PASSWORD` may both be omitted when the
relay is configured without authentication. Never expose these values to the
browser or commit them to the repository.
