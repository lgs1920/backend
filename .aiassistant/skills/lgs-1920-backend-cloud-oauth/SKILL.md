---
name: lgs-1920-backend-cloud-oauth
description: Maintain LGS1920 cloud OAuth providers, PKCE authorization, callbacks, token storage, session cookies, refresh behavior, and connected-provider APIs. Use when changing CloudAuthController.js, CloudOAuthStore.js, cloud provider configuration, or authenticated remote imports.
---

# LGS1920 Backend Cloud OAuth

Use this skill for authentication flows involving Google Drive, OneDrive, Dropbox, pCloud, or Nextcloud. Treat provider callbacks and tokens as security-sensitive boundary code.

## Workflow

1. Inspect `src/controllers/CloudAuthController.js`, `src/resources/CloudAuthResource.js`, and `src/utils/CloudOAuthStore.js` together.
2. Confirm the provider identifier, authorization URL, token URL, redirect URI, scopes, PKCE requirement, and environment variables.
3. Generate unpredictable state and PKCE values, consume authorization state exactly once, and enforce its expiry and provider binding.
4. Validate return URLs against the existing allowlist. Never redirect to an arbitrary user-provided host.
5. Keep tokens server-side. Use `HttpOnly`, `SameSite`, and environment-appropriate `Secure` cookie attributes.
6. Handle missing configuration, provider errors, invalid callbacks, expired tokens, and revoked sessions with controlled responses.
7. Add tests for state replay, invalid providers, redirect validation, cookie attributes, token expiry, and provider failure paths.

## Security constraints

- Never commit client secrets, access tokens, refresh tokens, authorization codes, or session identifiers.
- Never log authorization headers, cookies, token responses, or complete callback URLs when they contain secrets.
- Preserve the in-memory session expiry and cleanup behavior unless a durable store is explicitly designed and reviewed.
- Keep provider-specific URL normalization and scope handling isolated from generic session logic.
- Do not broaden CORS or redirect allowlists to make a failing provider flow pass.
