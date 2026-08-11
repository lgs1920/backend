# Launch registration administration

The backend provides a local Bun command for inspecting and removing launch registrations.

From the backend source checkout or the active production release:

```bash
bun run registrations --list
bun run registrations --remove visitor@example.org
bun run registrations clear
```

The `--remove` and `clear` commands ask for confirmation. Add `--yes` for a
non-interactive confirmation:

```bash
bun run registrations --remove visitor@example.org --yes
bun run registrations clear --yes
```

In local development, the command reads confirmed registrations from
`data/launch-registrations.json` below the current backend home. Pending
confirmations are stored separately in `data/launch-registrations-pending.json`
and are not included in the confirmed-registration list. A deployed release
reads the persistent confirmed path in its generated `servers.json`; for
example, production uses
`/home/www/lgs1920/production/backend/shared/launch-registrations.json` and the
backend derives the matching pending path beside it.
Set `LGS1920_REGISTRATION_FILE` to override the confirmed file used by this
CLI. The current destructive CLI commands operate on confirmed registrations
only; the backend uses `LGS1920_PENDING_REGISTRATION_FILE` for its pending store.

When run from a deployed `production/backend/current`,
`staging/backend/current`, or `test/backend/current` directory, the command
automatically stops and restarts the matching PM2 process around `--remove`
and `clear`. Local development paths do not invoke PM2. Override the automatic
detection with `LGS1920_PM2_APP` and `LGS1920_PM2_BIN` when needed.

The list output contains names, email addresses, and creation dates. Private
cancellation token hashes are never displayed.
