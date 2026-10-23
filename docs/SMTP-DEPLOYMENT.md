# SMTP relay deployment memo

The backend sends messages from `POST /contact` through Nodemailer. It needs
an outbound SMTP relay; it does not need to receive email and it should not
install a local mail server as part of each application release.

## Recommended deployment model

Use one verified SMTP relay account or credential set per environment:

| Environment | Credential scope |
| --- | --- |
| Test | Test relay credentials and test recipient where possible |
| Staging | Staging relay credentials and staging recipient |
| Production | Production relay credentials and configured recipient |

The relay provider must authorize the Studio sender domain. Configure SPF and
DKIM records as requested by the provider, and add a DMARC policy appropriate
for the domain. The support notification uses the visitor's first and last
name and email as `From`; the acknowledgement uses the stable Studio mailbox
as `From`. The relay must therefore allow the configured workflow, or the
support notification may be rejected by its anti-spoofing policy.

Installing Postfix, Exim, or another local SMTP server on the backend host is
not required for this application. A self-hosted mail server is a separate
operations project involving DNS, TLS, queue monitoring, abuse handling, and
sender reputation.

## Required backend variables

Set these values in the local backend `.env` file used by deployment. Do not
commit real values to Git or place them in a generated release archive.

```dotenv
LGS1920_SMTP_HOST=smtp.webmo.fr
LGS1920_SMTP_PORT=465
LGS1920_SMTP_SECURE=true
LGS1920_SMTP_PASSWORD=replace-with-a-secret
LGS1920_CONTACT_CSRF_SECRET=at-least-32-random-characters
LGS1920_CONTACT_TARGET_F7A91C=your-recipient@example.org
# Optional watchdog notification recipient and sender.
LGS1920_WATCHDOG_ALERT_TO=operations@example.org
LGS1920_WATCHDOG_ALERT_FROM=backend-alerts@example.org
# Optional timeout overrides, in milliseconds.
LGS1920_SMTP_CONNECTION_TIMEOUT_MS=15000
LGS1920_SMTP_GREETING_TIMEOUT_MS=10000
LGS1920_SMTP_SOCKET_TIMEOUT_MS=30000
```

For Nuxit, use `smtp.webmo.fr` with `465` and
`LGS1920_SMTP_SECURE=true` for implicit TLS. The backend requires a target
mapping and does not accept a raw recipient address from the browser.
Use `587` with `LGS1920_SMTP_SECURE=false` only for a relay that explicitly
requires STARTTLS.
When `LGS1920_SMTP_PASSWORD` is present, the address resolved from
`LGS1920_CONTACT_TARGET_*` is used as the SMTP username. `LGS1920_SMTP_USER`
is retained only as a fallback when no target address is available. Omit both
credentials when the relay allows unauthenticated delivery from the server IP.

## Clean server-side installation

The deployment layout keeps secrets outside versioned releases. For the
production backend, create a private shared directory once on the server:

```bash
install -d -m 700 /home/www/lgs1920/production/backend/shared
install -m 600 /dev/null /home/www/lgs1920/production/backend/shared/backend.env
```

The same shared directory stores the persistent launch-registration files at
`/home/www/lgs1920/production/backend/shared/launch-registrations.json` and
`/home/www/lgs1920/production/backend/shared/launch-registrations-pending.json`.
The backend creates them when the corresponding state is first written; never
place them inside `current` or a versioned release directory.

The deployment command uploads the local backend `.env` file to the matching
remote shared path through the active SSH connection. It creates the shared
directory with mode `700`, uploads the file without printing its contents, and
sets the remote file mode to `600`. The local file should also be owner-only.

For a manual server setup, edit `backend.env` through a protected
administrative session and use shell assignment syntax compatible with
`set -a`:

```dotenv
LGS1920_SMTP_HOST=smtp.webmo.fr
LGS1920_SMTP_PORT=465
LGS1920_SMTP_SECURE=true
LGS1920_SMTP_PASSWORD='replace-with-a-secret'
LGS1920_CONTACT_CSRF_SECRET='at-least-32-random-characters'
LGS1920_CONTACT_TARGET_F7A91C=your-recipient@example.org
LGS1920_WATCHDOG_ALERT_TO=operations@example.org
LGS1920_WATCHDOG_ALERT_FROM=backend-alerts@example.org
LGS1920_SMTP_CONNECTION_TIMEOUT_MS=15000
LGS1920_SMTP_GREETING_TIMEOUT_MS=10000
LGS1920_SMTP_SOCKET_TIMEOUT_MS=30000
```

Repeat the setup under the corresponding `test`, `staging`, or `production`
backend directory. Use separate credentials and recipients so a test cannot
send an accidental production message.

The file must not be copied into `releases/<version>`, committed, printed in
deployment logs, or exposed to browser code.

When `LGS1920_WATCHDOG_ALERT_TO` is configured, the backend deployment installs
a user-level cron watchdog. It probes the local `/ping` endpoint every five
minutes, waits for two consecutive failed cycles before attempting a PM2
restart, and sends operational recovery or restart notifications through the
configured SMTP relay. The watchdog state and logs remain in `shared`, outside
the versioned release. If the alert recipient is omitted, the watchdog keeps
operating and records failures without sending email.

The versioned backend release may retain the contact-form fallback templates
under `messages/forms/`. `bun build.js` copies only those contact fallback files
into the release. Launch-registration mail templates belong to the Site and are
sent as fresh rendered bodies on the initial, resend, and confirmation requests.

Keep values containing shell metacharacters quoted because the deployment
sources this file before starting PM2. For example:

```dotenv
LGS1920_SMTP_PASSWORD='replace-with-a-secret-containing-&-or-brackets'
```

The deployment rejects an invalid unquoted assignment before transferring it.

The frontend sends only an opaque target key such as `f7a91c`. The backend
resolves it through the `LGS1920_CONTACT_TARGET_*` variables. Add another
target by adding another server-side mapping; do not send its email address in
the browser request.

## PM2 startup

PM2 inherits the environment present when the process is started. Load the
shared file before starting or restarting the backend:

```bash
cd /home/www/lgs1920/production/backend/current
set -a
. ../shared/backend.env
set +a
/home/.bun/bin/pm2 startOrRestart /home/www/lgs1920/production/backend/current/ecosystem.config.js \
  --cwd /home/www/lgs1920/production/backend/current --update-env
/home/.bun/bin/pm2 save
```

After each release switch, restart PM2 with the same environment-loading
sequence. This keeps the SMTP configuration independent from the release
symlink and makes rollback safe.

The Studio deployment command uploads the local backend `.env` to the shared
backend path, then sources `../shared/backend.env` before invoking
`pm2 startOrRestart --update-env` for backend releases. The file is therefore
transferred as deployment configuration, not as part of the release archive.

The same deployment installs an idempotent user-level crontab block containing
the five-minute watchdog and an `@reboot` PM2 startup entry. The reboot entry
waits briefly, loads `shared/backend.env`, and reuses the PM2 startup flow
without requiring `sudo`. Existing user crontab entries outside the LGS1920
marker block are preserved.

Run a backend deployment from the backend repository after changing the local
file:

```bash
chmod 600 .env
bun run deploy -p
```

## Verification checklist

Run the following checks on the target server without printing the environment
file or its values:

```bash
/home/.bun/bin/pm2 status
curl -fsS https://api.example.org/ping
```

Send one contact message only from test or staging first. Confirm that the
response is successful, the support notification reaches the configured
recipient with `From: Visitor Name <visitor@example.org>`, and the
acknowledgement reaches the visitor with `From: LGS1920 Studio
<configured-target@example.org>`. Do not use a production contact form
submission as a connectivity test unless an operational test message has been
approved.

Expected failure behavior:

- Missing or invalid SMTP configuration returns HTTP `503`.
- Invalid contact data returns HTTP `400`.
- Rate-limited contact requests return HTTP `429` and a `Retry-After` header.
- Relay authentication or delivery failures return HTTP `503` without
  exposing provider credentials or upstream response bodies.

## Troubleshooting

- `Contact email delivery is temporarily unavailable`: verify that the PM2
  process inherited the shared environment and that the host and port are
  correct.
- If the initial registration email is delivered but confirmation reports that
  the additional email is unavailable, verify that the Site confirmation page
  sends both fresh rendered bodies and that the backend release matches the
  current API contract. No launch-registration template belongs in the backend
  release.
- Authentication failure: rotate the relay credential and confirm that the
  username and password belong to the same environment.
- TLS or connection failure: check the provider's required port and whether
  it expects STARTTLS (`587`/`false`) or implicit TLS (`465`/`true`).
- Message rejected: verify the sender domain, SPF/DKIM status, and the exact
  `LGS1920_CONTACT_TARGET_*` address authorized by the provider as the sender.
