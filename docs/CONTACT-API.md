# Public Studio launch registration API

The public site submits launch registrations to `POST /registration`.

## Request

The JSON body contains:

- `firstName`: required string, maximum 80 characters
- `lastName`: required string, maximum 80 characters
- `email`: required email address, maximum 254 characters
- `consent`: required boolean and must be `true`
- `website`: optional honeypot field that must remain empty

The endpoint returns only an acceptance status. It never returns the submitted personal data.

## Storage

Accepted registrations are stored in `data/launch-registrations.json` using the existing backend flat-file persistence pattern. The `data/` directory is ignored by Git and must be backed up and access-restricted by the deployment environment.

Each stored record contains an identifier, an ISO timestamp, the first name, last name, email address, consent timestamp, and the fixed `studio-launch` consent purpose. No IP address or browser fingerprint is stored.

The file is written through a temporary file and atomic rename. In-process mutations are serialized through a FIFO queue so concurrent submissions are not lost.
