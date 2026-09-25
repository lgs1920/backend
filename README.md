# backend
Backend for LGS1920

## Project skill

- [Secure backend contact mail](.aiassistant/skills/lgs-1920-backend-contact-mail/SKILL.md)

## Shared agent guidance

Read the shared baseline through [AGENTS.md](AGENTS.md) before the backend
rules. After cloning, enable the local Git hooks once:

```bash
bun run git:hooks:install
```

When local guidance links are present, the pre-commit hook copies their target
files into the commit and the post-commit hook restores the links. A standalone
clone therefore contains physical guidance files and has no dependency on the
local Studio directory. The same pre-commit hook updates staged source-file
headers; use `bun run headers:check` to verify them without changing files.

## Documentation

- [Backend count API flat-file analysis](docs/BACKEND-COUNT-API-FLAT-FILE-ANALYSIS.md)
- [Backend security baseline](docs/SECURITY.md)
- [Public Studio launch registration and contact APIs](docs/CONTACT-API.md)
- [SMTP relay deployment memo](docs/SMTP-DEPLOYMENT.md)
- [Bun command reference](docs/BUN-COMMANDS.md)
- [Launch registration administration](docs/LAUNCH-REGISTRATIONS-CLI.md)

The public contact API keeps SMTP credentials, CSRF material, and recipient
mappings in the backend environment only. The local `backend/.env` is uploaded
by the backend deployment workflow to the remote shared environment; it is not
included in a release archive or Studio build.

The site sends rendered Markdown messages with validated form metadata. The
backend owns transport validation, opaque recipient resolution, SMTP delivery,
and single-use registration confirmation and cancellation links; it does not
own the site's confirmation or cancellation pages or their localized content.
