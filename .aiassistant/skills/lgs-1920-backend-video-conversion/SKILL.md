---
name: lgs-1920-backend-video-conversion
description: Maintain LGS1920 FFmpeg video conversion jobs, multipart input parsing, progress polling and SSE, downloads, cancellation, temporary files, cleanup, and conversion error handling. Use when changing ConvertVideoController.js, conversions.js, or ConvertVideoResource.js.
---

# LGS1920 Backend Video Conversion

Use this skill for asynchronous conversion jobs exposed by the `/convert` API. Preserve the job lifecycle and make cleanup correct on success, failure, cancellation, disconnect, and restart.

## Workflow

1. Inspect `ConvertVideoController.js`, `src/controllers/conversions.js`, `ConvertVideoResource.js`, and the Studio conversion client before editing.
2. Define the accepted multipart fields, formats, codecs, limits, output naming, and response headers at the request boundary.
3. Keep conversion state transitions explicit: accepted, running, completed, failed, cancelled, downloaded, and cleaned up.
4. Spawn FFmpeg through the existing Bun integration. Do not interpolate unvalidated user input into shell commands or command strings.
5. Keep progress polling and SSE consistent, heartbeat connections, handle disconnects, and do not leak internal process errors.
6. Resolve input and output paths inside the controlled temporary directory. Clean up on every terminal path and avoid deleting active jobs.
7. Make cancellation idempotent and ensure a late FFmpeg event cannot revive a cancelled or cleaned-up conversion.
8. Add focused tests for validation, progress, cancellation, download headers, stale cleanup, process failure, and temporary-file cleanup.

## Safety and reliability

- Enforce file size, duration, format, and resource limits before starting expensive work.
- Keep conversion IDs opaque and do not use user-provided names as identifiers.
- Do not include full local paths, command arguments, or raw FFmpeg stderr in public responses.
- Dispose of timers, streams, process listeners, and SSE controllers on every exit path.
- Preserve the existing CORS and progress headers expected by the Studio client.
- Never run the development server manually while validating a conversion change.
