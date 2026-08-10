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

The command reads `data/launch-registrations.json` below the current backend
home. Set `LGS1920_REGISTRATION_FILE` to use another explicit file path.

When run from a deployed `production/backend/current`,
`staging/backend/current`, or `test/backend/current` directory, the command
automatically stops and restarts the matching PM2 process around `--remove`
and `clear`. Local development paths do not invoke PM2. Override the automatic
detection with `LGS1920_PM2_APP` and `LGS1920_PM2_BIN` when needed.

The list output contains names, email addresses, and creation dates. Private
cancellation token hashes are never displayed.
