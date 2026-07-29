---
name: lgs-1920-backend-journey-import
description: Maintain LGS1920 remote journey import from public URLs and cloud sharing links, including provider URL normalization, SSRF protection, redirects, size limits, format detection, authenticated downloads, and import response contracts. Use when changing JourneyImportController.js or JourneyImportResource.js.
---

# LGS1920 Backend Journey Import

Use this skill for the backend endpoint that retrieves GPX, GeoJSON, JSON, and KML journey files before the Studio parses them. Keep remote fetching bounded, provider-aware, and safe.

## Workflow

1. Inspect `JourneyImportController.js`, `JourneyImportResource.js`, cloud session helpers, and the Studio request contract.
2. Parse and validate the URL before fetching. Allow only HTTP(S), reject loopback, private, link-local, and blocked IPv6 hosts, and preserve the configured provider allowlist.
3. Normalize known Google Drive, Dropbox, OneDrive, pCloud, iCloud, and Nextcloud share links without accepting arbitrary provider-specific shortcuts.
4. Follow redirects manually with a fixed maximum. Re-check the destination host on every hop and remove authorization when the host changes.
5. Enforce the remote fetch timeout and maximum body size before buffering the response. Abort cancelled or timed-out requests.
6. Derive a safe file name and supported extension from URL and content-disposition metadata. Never use a remote path as a local path.
7. Return stable success and controlled failure codes such as `remote_timeout`, `remote_file_too_large`, and `unsupported_format`.
8. Add regression tests for provider links, redirects, blocked hosts, missing headers, oversized responses, malformed URLs, and failed upstream access.

## Security constraints

- Treat all remote URLs and response metadata as untrusted input.
- Do not allow SSRF through DNS aliases, numeric IPv4 forms, IPv4-mapped IPv6, redirects, or provider URL transformations.
- Do not silently accept an unsupported format or invent missing journey data in the backend.
- Keep authenticated cloud imports behind the existing OAuth session and provider token checks.
- Do not expose upstream response bodies, credentials, filesystem paths, or stack traces in public errors.
