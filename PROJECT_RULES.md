# Project rules

This is the canonical source for the LGS1920 backend AI-agent and development rules. The backend is the Bun/Elysia service consumed by LGS1920 Studio.

## 1. Core directives

- **Language:** All conversational responses must be in French.
- **Documentation:** JSDoc, inline comments, code documentation, API descriptions, and project documentation must be in professional English.
- **Scope:** Inspect the current Git status before editing and preserve unrelated user changes.
- **Autonomy:** Make safe local decisions when the intended behavior is clear. Ask before changing an external contract, deploying, publishing, or discarding user work.
- **Logging:** Use direct `console.log`, `console.error`, or `console.table` only when direct logging is explicitly requested. Never log secrets.

## 2. Coding style

- Use Bun as the runtime and follow the existing JavaScript module style.
- Do not introduce semicolons in new or modified code. Do not reformat unrelated legacy code solely to remove existing semicolons.
- Prefer named exports and do not add `export default`.
- Use arrow functions for functions and class fields, except for class constructors.
- Add a professional English JSDoc block to every new or modified function and method.
- Keep files focused. Split a file when it becomes difficult to review or exceeds 1500 lines.
- Preserve the existing import paths and `.js` extension conventions in the files being changed.

## 3. Architecture

- **Runtime:** Bun.
- **HTTP framework:** Elysia.
- **Route wiring:** `src/index.js` and `src/resources/`.
- **Request orchestration:** `src/controllers/`.
- **Shared behavior:** `src/utils/` and `src/controllers/conversions.js`.
- Keep route registration, controller behavior, and reusable utilities separate.
- Keep OpenAPI metadata, CORS headers, response envelopes, and client-facing route constants synchronized with the API implementation.
- Do not introduce another backend framework, ORM, persistence layer, or process manager without explicit approval.
- **Site-owned launch-registration mail:** The Site owns every localized launch-registration mail catalog, including the initial confirmation, resend confirmation, post-confirmation acknowledgement, and Studio notification. The backend must not add, load, or use launch-registration message templates or fallback files. It may validate Site-rendered bodies and replace only the signed `{{confirm-url}}` and `{{revoke-url}}` placeholders.
- Launch-registration `renderedMessage` and `supportRenderedMessage` values are transient request data. Never persist them; resend and post-confirmation delivery must receive fresh Site-rendered values in the corresponding request.

## 4. Security and reliability

- Validate path parameters, query parameters, JSON, multipart data, file names, URLs, provider identifiers, and redirect targets at the boundary.
- Prevent path traversal, SSRF, unsafe redirects, unbounded downloads, shell argument injection, and uncontrolled temporary-file growth.
- Keep OAuth secrets, tokens, cookies, credentials, and private server configuration out of logs, responses, generated bundles, and Git.
- Use bounded timeouts, size limits, cancellation, and cleanup for remote requests and FFmpeg jobs.
- Return controlled client errors. Do not expose stack traces, local paths, upstream bodies, tokens, or raw process commands.
- Make cleanup idempotent and safe when a job, request, or process has already ended.

## 5. Documentation and testing

- Update `README.md`, `docs/`, API descriptions, and nearby documentation when behavior or configuration changes.
- Document environment variables, provider requirements, route contracts, limits, error codes, and deployment assumptions in English.
- Add relevant regression tests for every behavior change. Prefer deterministic tests around pure helpers and isolated route/controller contracts.
- Do not import `src/index.js` in tests if doing so starts a listening server. Extract an app factory when needed.
- Validate with focused tests, `bun build`, and static checks appropriate to the change. Do not run the development server manually as a validation step.

## 6. Versioning and deployment

- Treat `version.json` as the current backend/API version source.
- Inspect `build.js`, `build.json`, `deploy.js`, `deployment/`, `servers.json`, and `dist/` before release changes.
- Never edit generated bundles manually. Regenerate release artifacts from source.
- Never deploy, publish, or overwrite an existing versioned distribution without an explicit user request and a scope check.
- Keep dependency manifests and the Bun lockfile synchronized when dependencies change.

## 7. Issue and release workflow

### Cross-repository issue ownership

- The managed repositories are `studio`, `site`, and `backend`. Create an issue in the repository that owns the API, service, or deployment change.
- Never mirror a `site` or `backend` issue into `studio`. Record cross-repository dependencies with direct links to the owning issue; do not create duplicate issues.
- During the mirror-removal migration, inventory confirmed `studio` mirrors of `backend` issues, transfer missing information to the owning issue, remove links to the mirror from the original issue and related documentation, and delete only unambiguous mirror issues.
- Do not delete an issue with independent scope or unclear ownership. Report ambiguous cases for explicit user decision and verify that no active issue links to a deleted mirror.

### Release and changelog workflow

- Backend release notes participate in the shared public changelog maintained in the sibling Studio repository at `../studio/public/assets/changelog/`.
- Use the filename `YYYYMMDD-<version>.md`, where `<version>` is the exact release version including prerelease identifiers. If the target file does not exist, create it automatically with today's date and the nearest existing changelog's header conventions.
- Group closed issues and remaining open bugs/features by owning repository (`studio`, `site`, or `backend`). Omit empty repository headings and omit a category heading when it has no entries.
- Link every issue to its owning repository. Never include mirror issue links or duplicate issue numbers.
- Do not invent issue numbers, versions, dates, release membership, or user-facing outcomes.

## 8. Git workflow

- Create a commit only when the user explicitly requests one.
- Use key-based commit prefixes: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, or `chore`.
- Keep each commit focused and inspect staged content before committing.
- Never stage `.env`, credentials, tokens, local machine configuration, or unrelated generated noise.
- Never reset, checkout, or discard user changes without explicit authorization.
- Report the exact commit scope and remaining working-tree changes after a commit.

## 8. Skill selection

- Use the `lgs-1920-backend-*` skills for backend files and backend-specific behavior.
- Use the copied `lgs-1920-studio-*` skills only when the task explicitly crosses into Studio behavior or requires shared product context.
- Prefer the narrowest applicable skill, then combine it with the testing or release skill when the change affects those concerns.
