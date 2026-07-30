---
name: lgs-1920-backend-assets-versioning
description: Maintain LGS1920 backend metadata and file-backed endpoints, including version.json, the versions and changelog APIs, build metadata, controlled local file access, and service-worker cache metadata. Use when changing VersionsController.js, ChangelogController.js, ReadFileController.js, SWCacheController.js, FileUtils.js, version.json, build.json, or their resources.
---

# LGS1920 Backend Assets and Versioning

Use this skill for backend endpoints and release metadata backed by local files. Treat paths, file names, version values, and sibling-project files as untrusted or externally visible contracts.

## Workflow

1. Inspect the affected controller and resource together with `src/index.js`, `version.json`, `build.json`, and the relevant asset directory.
2. Treat `version.json` as the source of the current backend version and API version. Do not infer the release version from the legacy `package.json` version field.
3. Keep `/versions`, `/changelog`, `/read`, ping metadata, and cache metadata aligned with the files actually shipped by the build. Verify whether a route is registered before changing an apparently unused resource.
4. Resolve local files beneath an explicit allowed root. Reject absolute paths, traversal, encoded traversal, symlink escapes, unexpected extensions, and directories before reading or returning content.
5. Validate changelog file names before decoding or joining them to the changelog directory. Keep version sorting deterministic and preserve the existing response shape.
6. When the versions endpoint reads the sibling Studio `version.json`, inspect that file through the existing path helper and do not silently change Studio files from the backend repository.
7. Keep `build.json` and generated asset contents synchronized through the existing build workflow. Never edit generated bundles or release directories by hand.
8. Add focused tests for missing files, malformed metadata, traversal attempts, encoded separators, unsupported names, deterministic ordering, and version response contracts.

## Release boundaries

- Keep the backend version in `version.json` and the API version stable unless the API contract intentionally changes.
- Make `build.js --version` agree with `version.json.backend` for a release check.
- Inspect `dist/<version>` before generating output and do not overwrite an existing versioned directory without explicit approval.
- Do not expose local paths, stack traces, raw filesystem errors, or sibling-project configuration in public responses.
