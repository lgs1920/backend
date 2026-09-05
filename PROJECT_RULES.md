# Project rules

This is the canonical source for the LGS1920 backend AI-agent and development rules. The backend is the Bun/Elysia service consumed by LGS1920 Studio.

## 1. Core directives

- **Language:** All conversational responses must be in French.
- **Documentation and issues:** JSDoc, inline comments, code documentation, API descriptions, project documentation, and issue content must be in professional English.
- **Scope:** Inspect the current Git status before editing and preserve unrelated user changes.
- **Autonomy:** Make safe local decisions when the intended behavior is clear. Ask before changing an external contract, deploying, publishing, or discarding user work. Never extrapolate beyond the user's request; final decisions belong to the user.
- **Nuance and analytical rigor:** Avoid unwarranted certainty. Simplistic or overly categorical analyses can omit relevant context and lead to incorrect conclusions.
- **Depth of analysis:** Explore relevant subtleties, cross-check perspectives, and identify potential blind spots and biases before reaching a conclusion.
- **Technical verification:** Be especially vigilant with calculations, logic, and overall consistency. If data or reasoning appears anomalous or uncertain, explicitly identify the issue and re-check it step by step.
- **Logging:** Use direct `console.log`, `console.error`, or `console.table` only when direct logging is explicitly requested. Never log secrets.

## 2. Coding style

- Use Bun as the runtime and follow the existing JavaScript module style.
- Do not introduce semicolons in new or modified code. Do not reformat unrelated legacy code solely to remove existing semicolons.
- Prefer named exports and do not add `export default`.
- Use arrow functions for functions and class fields, except for class constructors.
- Add a professional English JSDoc block to every new or modified function and method.
- Keep new files focused and below 1500 lines. For an existing file above 1500 lines, split it when necessary for the requested change; otherwise make the targeted correction and report the refactoring opportunity separately.
- Summarize changes, validation, and remaining work with file links. Provide full file contents only when explicitly requested.
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
- Use bounded timeouts, size limits, cancellation, and cleanup for remote requests and long-running jobs.
- Return controlled client errors. Do not expose stack traces, local paths, upstream bodies, tokens, or raw process commands.
- Make cleanup idempotent and safe when a job, request, or process has already ended.

## 5. Documentation and testing

### Documentation status

- Documentation must describe implemented behavior and must not cover behavior that is no longer taken into account, unless it is explicitly presented as historical.
- Add production-oriented English comments for critical logic.
- Add any introduced UI shortcut to the dedicated shortcuts documentation.
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

### Issue management

- Before creating an issue, ask for any missing explanations or clarifications needed to understand and scope the request. Then present the complete proposed issue content for explicit user validation. Do not create the issue until the user has validated the proposal.
- For every issue, propose a solution and an implementation plan for explicit user validation. Do not create or implement the issue until the proposed solution and plan have been validated.
- Present the complete issue content, proposed solution, and implementation plan together for explicit validation. Reuse validation already given for the same proposal. Request renewed validation only for material changes to the approved scope, solution, or plan. A request to create an issue does not by itself validate an unseen proposal.
- Fill every known and applicable issue field, including title, description, assignee, labels, type, priority, repository, Project status, and `Target release`. Do not invent a release, label, priority, or other value when it is not known.
- Assign an issue to the user requesting its creation unless the user explicitly specifies another assignee.
- Use the Project-level `Target release` field as the source of truth for release planning. Use `Unplanned` when no approved release has been selected, and add a new target-release option only after the release has been approved.
- When migrating an existing milestone, copy its exact title to the matching `Target release` option when one exists. Keep the milestone until the result and dependent reporting have been reviewed; do not clear or delete it automatically.
- Use the Project `Status` value `Backlog` for accepted work that is not ready to start. Do not encode versions in labels or statuses when `Target release` already provides that information.
- Write every issue body with a short context, requested behavior, acceptance criteria, and optional notes or questions. Keep one request per issue and prefer bullet lists for requirements.

### Cross-repository issue ownership

- The managed repositories are `studio`, `site`, and `backend`. Create an issue in the repository that owns the API, service, or deployment change.
- Never mirror a `site` or `backend` issue into `studio`. Record cross-repository dependencies with direct links to the owning issue; do not create duplicate issues.
- During the mirror-removal migration, inventory confirmed `studio` mirrors of `backend` issues, transfer missing information to the owning issue, remove links to the mirror from the original issue and related documentation, and delete only unambiguous mirror issues.
- Do not delete an issue with independent scope or unclear ownership. Report ambiguous cases for explicit user decision and verify that no active issue links to a deleted mirror.

### Project workflow statuses

Use the shared organization Project and keep its `Status` field limited to the delivery workflow:

- `Triage`: new work that needs clarification, ownership, or prioritization.
- `Backlog`: accepted work that is not ready to start.
- `Ready`: scoped work with acceptance criteria and a target release.
- `In Progress`: active implementation.
- `Review`: a linked pull request is open.
- `QA`: review is approved and validation is in progress.
- `Blocked`: an explicit dependency or decision prevents progress.
- `Done`: the linked pull request is merged and the work is complete.

New issues start in `Triage` unless their validated scope already justifies a different workflow state. Move an issue to `Review` when its pull request opens, to `QA` after review approval, and to `Done` only after merge. Add every implementation issue to the Project and link it to its pull request.

### Release and changelog workflow

- Backend release notes participate in the shared public changelog maintained in the sibling Studio repository at `../studio/public/assets/changelog/`.
- Use the filename `YYYYMMDD-<version>.md`, where `<version>` is the exact release version including prerelease identifiers. If the target file does not exist, create it automatically with today's date and the nearest existing changelog's header conventions.
- For the shared public changelog, follow [Studio PROJECT_RULES.md §7](../studio/PROJECT_RULES.md#7-release-changelog-workflow) for sections, ordering, repository headings, and issue links. Historical formatting is not authoritative where it conflicts.
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
