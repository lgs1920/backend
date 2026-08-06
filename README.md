# backend
Backend for LGS1920

## Project skill

- [Secure backend contact mail](.aiassistant/skills/lgs-1920-backend-contact-mail/SKILL.md)

## Documentation

- [Backend count API flat-file analysis](docs/BACKEND-COUNT-API-FLAT-FILE-ANALYSIS.md)
- [Backend security baseline](docs/SECURITY.md)
- [Public Studio launch registration and contact APIs](docs/CONTACT-API.md)
- [SMTP relay deployment memo](docs/SMTP-DEPLOYMENT.md)

The public contact API keeps SMTP credentials, CSRF material, and recipient
mappings in the backend environment only. The local `backend/.env` is uploaded
by the backend deployment workflow to the remote shared environment; it is not
included in a release archive or Studio build.
