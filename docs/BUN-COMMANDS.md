# Backend Bun command reference

Run the commands below from the backend repository unless a production path is
specified.

## Installation and dependency checks

```bash
cd /home/christian/devs/assets/lgs1920/backend
bun --version
bun install
```

Run `bun install` only when installing or updating dependencies. Do not run it
inside a production release as part of routine operations.

## Development

Start the backend with hot reload:

```bash
bun run dev
```

Start the entry point once without hot reload:

```bash
bun run src/index.js
```

## Tests

Run the complete backend test suite:

```bash
bun test
```

The package alias is also available:

```bash
bun run test
```

Run one or more focused test files:

```bash
bun test tests/launch-registration.test.js
bun test tests/launch-registrations-cli.test.js
bun test tests/contact-mail.test.js
```

## Backend builds

Build an unminified release directory:

```bash
bun build.js --version 1.0.50
```

The short option is equivalent:

```bash
bun build.js -v=1.0.50
```

Build the minified production bundle:

```bash
bun build.js --version 1.0.50 --minify
```

The generated files are written to `dist/<version>/`. The release includes
the backend bundle, the registration administration command, and the package
manifest needed by `bun run registrations`.

## Deployment

Show deployment help:

```bash
bun run deploy -- --help
```

Deploy the backend to production, staging, or test:

```bash
bun run deploy -- --prod
bun run deploy -- --staging
bun run deploy -- --test
```

Create and package a local release without copying it to the server:

```bash
bun run deploy -- --prod --dry-run
```

The deployment requires the matching password environment variable, such as
`LGS1920_PASSWORD_PRODUCTION`. Never place that value in a tracked file or
print it in a command log.

## Launch registration administration

List registrations without exposing cancellation token hashes:

```bash
bun run registrations --list
```

Remove one registration by email address:

```bash
bun run registrations --remove visitor@example.org
```

Clear all registrations:

```bash
bun run registrations clear
```

Both destructive commands ask for confirmation. Use `--yes` only when the
operation has already been confirmed by the operator:

```bash
bun run registrations --remove visitor@example.org --yes
bun run registrations clear --yes
```

The same commands work from an active production release:

```bash
cd /home/www/lgs1920/production/backend/current
bun run registrations --list
bun run registrations --remove visitor@example.org
bun run registrations clear
```

For destructive operations launched from a deployed `production/backend/current`,
`staging/backend/current`, or `test/backend/current` directory, the command
automatically stops and restarts the matching PM2 process. Local development
paths do not invoke PM2.

Use an explicit data file when operating on a non-default storage location:

```bash
LGS1920_REGISTRATION_FILE=/path/to/launch-registrations.json bun run registrations --list
```

Override PM2 detection only when the deployment layout is non-standard:

```bash
LGS1920_PM2_APP=backend-production \
LGS1920_PM2_BIN=/home/.bun/bin/pm2 \
bun run registrations clear
```

## Backend process control

From an active deployed backend release, stop the PM2-managed backend cleanly:

```bash
bun run backend:stop
```

Start or restart the backend with the shared environment loaded, refresh the
PM2 environment, and save the PM2 process list:

```bash
bun run backend:start
```

These commands detect `backend-production`, `backend-staging`, or
`backend-test` from the active release path. They fail in an ordinary local
development checkout instead of stopping an unrelated process. For a
non-standard layout, set `LGS1920_PM2_APP` and `LGS1920_PM2_BIN`.

## Running a deployed backend manually

PM2 normally owns the production process. For a controlled foreground run
from an active release:

```bash
cd /home/www/lgs1920/production/backend/current
bun run backend.js
```

Load the shared environment before starting the backend manually or through
PM2. Do not print the environment file:

```bash
set -a
. ../shared/backend.env
set +a
bun run backend.js
```

For the normal PM2 workflow, see
[`SMTP-DEPLOYMENT.md`](SMTP-DEPLOYMENT.md#pm2-startup).
