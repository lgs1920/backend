---
name: lgs-1920-backend-api
description: Maintain LGS1920 backend HTTP APIs built with Bun and Elysia, including route resources, controllers, validation, response contracts, CORS, Swagger metadata, and error handling. Use when adding or changing endpoints under src/resources, src/controllers, or src/index.js.
---

# LGS1920 Backend API

Use this skill for any change to the backend HTTP surface. Keep the existing resource/controller split and inspect the route registration, configuration, and client consumer before editing.

## Workflow

1. Locate the route constant, resource, controller, related utility, and consuming Studio request before changing behavior.
2. Define the request inputs, validation rules, response shape, status codes, headers, timeout, and failure behavior.
3. Validate query parameters, path parameters, JSON, multipart data, and remote URLs at the HTTP boundary.
4. Use the existing Bun-native APIs and Elysia instance. Do not introduce a second server framework or bypass the resource registration path.
5. Keep OpenAPI metadata synchronized with the actual route contract and preserve CORS requirements for the Studio client.
6. Return safe client errors without exposing filesystem paths, provider tokens, FFmpeg commands, or stack traces.
7. Add focused route or controller tests when behavior changes. Prefer extracting an app factory if importing `src/index.js` would start a server during tests.

## Backend conventions

- Keep route names and shared constants in `src/index.js` unless a route-specific module owns them.
- Keep request orchestration in controllers and route wiring in resources.
- Reuse the project's error status and JSON response conventions before inventing a new envelope.
- Preserve named exports and the existing Bun runtime.
- Never trust user-provided paths, URLs, file names, origins, or provider identifiers.
- Do not run the development server manually as a validation step.
