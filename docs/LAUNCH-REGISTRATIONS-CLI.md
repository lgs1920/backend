# Launch registration administration

The backend provides a local Bun command for inspecting and removing launch registrations.

From the backend source checkout or the active production release:

```bash
bun run registrations --list
bun run registrations --remove visitor@example.org
bun run registrations clear                 # confirmed only (default)
bun run registrations clear --confirmed    # confirmed only
bun run registrations clear --pending      # pending only
bun run registrations clear --all          # confirmed and pending
```

`--clear` is accepted as an alias for `clear`. All destructive commands ask
for confirmation. Add `--yes` for a non-interactive confirmation:

```bash
bun run registrations --remove visitor@example.org --yes
bun run registrations clear --yes
bun run registrations clear --confirmed --yes
bun run registrations clear --pending --yes
bun run registrations clear --all --yes
```

In local development, the command reads confirmed registrations from
`data/launch-registrations.json` below the current backend home. Pending
confirmations are stored separately in `data/launch-registrations-pending.json`
and are not included in the confirmed-registration list. A deployed release
reads the persistent confirmed path in its generated `servers.json`; for
example, production uses
`/home/www/lgs1920/production/backend/shared/launch-registrations.json` and the
backend derives the matching pending path beside it.
Clear scopes are mutually exclusive. `clear` is equivalent to
`clear --confirmed`. The `clear --pending` variant only removes pending
confirmations, while `clear --all` removes both stores. Each clear confirmation
states exactly which stores will be deleted. Set
`LGS1920_REGISTRATION_FILE` to override the confirmed file used by this
CLI. The pending variants use
`LGS1920_PENDING_REGISTRATION_FILE` when it is configured or the derived
pending path beside the confirmed file otherwise. The backend uses the same
environment variable for its pending store.

When run from a deployed `production/backend/current`,
`staging/backend/current`, or `test/backend/current` directory, the command
automatically stops and restarts the matching PM2 process around `--remove`
and `clear`. Local development paths do not invoke PM2. Override the automatic
detection with `LGS1920_PM2_APP` and `LGS1920_PM2_BIN` when needed.

The list output contains names, email addresses, and creation dates. Private
cancellation token hashes are never displayed.
