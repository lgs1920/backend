---
name: lgs-1920-backend-release-deployment
description: Prepare and validate LGS1920 backend releases, including version.json, build.js, build.json, dist output, deploy.js, platform selection, dependency changes, and Bun deployment configuration. Use when preparing a backend version or deployment.
---

# LGS1920 Backend Release Deployment

Use this skill for release and deployment work. Treat `version.json` as the current backend/API version source, not the legacy `package.json` version field, and inspect the generated artifact policy before changing `dist/`.

The backend release contains contact-form fallbacks only. Launch-registration
message catalogs belong to the Site release and must not be copied into the
backend artifact; the backend accepts fresh Site-rendered bodies at request time.

## Shared issue and changelog policy

- Treat `studio`, `site`, and `backend` as separate issue repositories. Use the repository that owns the change and link directly to that issue.
- Never create or use a mirror issue in `studio` for a `site` or `backend` issue. For legacy mirrors, confirm ownership, remove references to the mirror from the owning issue and related documents, then delete only confirmed mirrors. Report ambiguous cases.
- The public release changelog is maintained in the sibling Studio repository at `../studio/public/assets/changelog/` with the filename `YYYYMMDD-<version>.md`. If the target file is absent, create it automatically with today's date and the nearest existing file's header conventions.
- Group closed issues and remaining bugs/features by owning repository. Omit empty repository headings and omit a category heading when it has no entries. Never include mirror links.

### Changelog formatting

- Use the exact filename `YYYYMMDD-<version>.md`, where `YYYYMMDD` is the release date and `<version>` is the exact version, including prerelease identifiers.
- Before creating a missing file, inspect the nearest existing changelog in the same release line. Preserve its heading level, title style, section spelling, and blank-line conventions. Never overwrite an existing target file merely to normalize historical formatting.
- The first heading must identify the release and its user-facing theme. Do not add a generated date line unless the established pattern for that release line includes one.
- Render closed issues under `Closed Issues`, then render `Remaining Bugs` and `Remaining Features` only when entries exist. Within each category, group entries under `Studio`, `Site`, and `Backend` according to the owning repository.
- Omit a repository heading when it has no entries in the category. Omit the category heading when no repository has entries. Do not render empty headings, placeholder text, or empty lists.
- Preserve the issue title's meaning, correct only obvious formatting errors, and link every issue to its owning repository URL.

## Workflow

1. Inspect `version.json`, `package.json`, `build.js`, `build.json`, `deploy.js`, `deployment/`, `servers.json`, and the current Git diff.
2. Decide whether the change requires a version bump, dependency lock refresh, generated bundle, deployment configuration update, or only source changes.
3. Validate semantic version format, confirm that `build.js --version` matches `version.json.backend`, and keep the API version stable unless the API contract intentionally changes.
4. Review shared release issue data and update the Studio public changelog when the backend change belongs to a shared release. Create the target file when absent, using today's date and the established header convention.
5. Build with the repository's Bun command and verify the output contains the expected entry point and configuration without committing secrets.
6. Use the existing deployment platform selection (`production`, `staging`, or `test`) and inspect the resulting target before deploying.
7. Verify version metadata, route registration, environment requirements, and generated artifact scope after the build. Confirm that no launch-registration template or fallback is present in the generated backend artifact.
8. Report exact release files and uncommitted generated output. Do not deploy or publish without an explicit user request.

## Release constraints

- Never edit generated bundles manually. Regenerate them from source when they belong in the release.
- Never commit `.env`, tokens, credentials, private server configuration, or local absolute paths.
- Keep `version.json` and build metadata synchronized with the actual release scope.
- Do not silently overwrite an existing `dist/<version>` directory; inspect it first and use a new version or explicit user approval.
- Do not run deployment commands as part of validation unless the user explicitly requests deployment.
