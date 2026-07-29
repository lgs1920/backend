---
name: lgs-1920-backend-release-deployment
description: Prepare and validate LGS1920 backend releases, including version.json, build.js, build.json, dist output, deploy.js, platform selection, dependency changes, and Bun deployment configuration. Use when preparing a backend version or deployment.
---

# LGS1920 Backend Release Deployment

Use this skill for release and deployment work. Treat `version.json` as the current backend/API version source, not the legacy `package.json` version field, and inspect the generated artifact policy before changing `dist/`.

## Workflow

1. Inspect `version.json`, `package.json`, `build.js`, `build.json`, `deploy.js`, `deployment/`, `servers.json`, and the current Git diff.
2. Decide whether the change requires a version bump, dependency lock refresh, generated bundle, deployment configuration update, or only source changes.
3. Validate semantic version format, confirm that `build.js --version` matches `version.json.backend`, and keep the API version stable unless the API contract intentionally changes.
4. Build with the repository's Bun command and verify the output contains the expected entry point and configuration without committing secrets.
5. Use the existing deployment platform selection (`production`, `staging`, or `test`) and inspect the resulting target before deploying.
6. Verify version metadata, route registration, environment requirements, and generated artifact scope after the build.
7. Report exact release files and uncommitted generated output. Do not deploy or publish without an explicit user request.

## Release constraints

- Never edit generated bundles manually. Regenerate them from source when they belong in the release.
- Never commit `.env`, tokens, credentials, private server configuration, or local absolute paths.
- Keep `version.json` and build metadata synchronized with the actual release scope.
- Do not silently overwrite an existing `dist/<version>` directory; inspect it first and use a new version or explicit user approval.
- Do not run deployment commands as part of validation unless the user explicitly requests deployment.
