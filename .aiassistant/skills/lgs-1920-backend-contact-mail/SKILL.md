---
name: lgs-1920-backend-contact-mail
description: Securely maintain the LGS1920 public contact-mail API, including validation, CSRF/origin protection, rate limiting, SMTP TLS and timeout configuration, opaque recipient targets, tests, and deployment environment handling. Use when changing contact routes, mail delivery, SMTP settings, support recipients, or production mail deployment.
---

# Backend contact mail

Use this skill for changes to the backend contact form flow. The backend is the only
place that may know SMTP credentials or recipient addresses; the public site sends
an opaque target key and never receives mail secrets.

Launch-registration mail catalogs are Site-owned. The backend must not add, load,
package, or use launch-registration templates or fallback messages. The Site sends
fresh rendered confirmation, resend, post-confirmation, and Studio-notification
bodies with the corresponding request; `renderedMessage` and
`supportRenderedMessage` are transient and must never be persisted.

## Workflow

1. Read `PROJECT_RULES.md`, then inspect `src/resources/ContactMailResource.js`,
   `src/controllers/ContactMailController.js`, `src/services/ContactMailService.js`,
   `src/utils/ContactRequestSecurity.js`, and `src/utils/ContactRateLimiter.js`.
2. Preserve the API contract in `docs/CONTACT-API.md`: exact allowed origins,
   short-lived signed token, bounded fields, honeypot handling, opaque target key,
   generic error responses, HTTP 429 behavior, and the Site-owned launch-registration
   mail contract. For launch-registration mail, only replace the signed
   `{{confirm-url}}` and `{{revoke-url}}` placeholders; do not synthesize or append
   a backend message.
3. Keep SMTP configuration server-only. Use `backend/.env` locally, keep it ignored,
   and never print or commit its values. Add a target as an opaque mapping such as
   `LGS1920_CONTACT_TARGET_C4P7Z2=support@lgs1920.fr`; do not expose the address in
   browser code or API responses.
4. For SMTP, keep certificate verification enabled, require implicit TLS on port
   465, require STARTTLS for non-secure mode, and retain bounded connection,
   greeting, and socket timeouts. Do not weaken TLS validation to make a relay work.
5. Keep the in-process limiter bounded and proxy-aware only when
   `LGS1920_TRUST_PROXY=true`. Never trust arbitrary forwarded headers on a public
   deployment.
6. Add or update focused tests for validation, origin/token checks, rate limits,
   SMTP options, and failure handling. Test configuration without sending a real
   message.
7. Before handoff, run `bun test`, `bun build src/index.js`, and `git diff --check`.
   Run `bun pm scan` only when a scanner is configured; report unavailable scanners
   rather than claiming a dependency audit.

## Deployment boundary

The Studio deployment orchestrator uploads the local backend `.env` over the active
SSH/SFTP connection to the remote backend shared path, normally
`shared/backend.env`, with directory mode `700` and file mode `600`. PM2 sources
that file and applies it with `--update-env`. The file is not part of a release
archive, Studio build, browser bundle, or Git history.

Use `docs/SMTP-DEPLOYMENT.md` for the complete procedure. A production deployment
requires explicit user authorization and a readable local `backend/.env`; do not
deploy merely to test configuration.

## Documentation

Keep `docs/CONTACT-API.md`, `docs/SMTP-DEPLOYMENT.md`, `docs/SECURITY.md`, and
`.env.example` aligned with implementation. Documentation examples must use
placeholders for passwords, tokens, and private keys. Never add a real secret to
`.env.example`, a log, a test fixture, or a generated release.
