---
name: lgs-1920-backend-testing
description: Create and run reliable tests for the LGS1920 Bun/Elysia backend, including route contracts, controller validation, SSRF and OAuth boundaries, asynchronous conversion jobs, cleanup, and error responses. Use whenever backend behavior changes or a regression is investigated.
---

# LGS1920 Backend Testing

Use this skill for backend regressions and new behavior. Read the affected implementation and neighboring tests before choosing the test boundary.

## Workflow

1. Reproduce the behavior with the smallest deterministic test or helper-level fixture.
2. Prefer testing observable HTTP responses, status codes, headers, response bodies, state transitions, and cleanup over private implementation details.
3. Test invalid and boundary inputs as deliberately as the happy path: malformed URLs, blocked hosts, missing fields, oversized files, expired state, cancelled jobs, and upstream failures.
4. Isolate Elysia route tests from server startup. If `src/index.js` listens during import, extract a reusable app factory before adding broad integration tests.
5. Mock network providers, FFmpeg processes, timers, and filesystem boundaries only where needed to keep tests deterministic.
6. Run the focused test file first, then the relevant suite and build validation. Report unavailable test infrastructure honestly.

## Required regression coverage

- API changes: request validation, success contract, status codes, CORS or progress headers, and controlled errors.
- OAuth changes: state single-use behavior, redirect allowlists, cookie attributes, token expiry, and provider failures.
- Journey imports: URL normalization, redirect limits, private-host blocking, size and timeout limits, content-disposition, and supported formats.
- Video conversion: state transitions, progress polling or SSE, cancellation, process failures, download behavior, and temporary-file cleanup.

Never weaken an assertion or remove a security case merely to make a test pass.
