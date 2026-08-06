# Backend security baseline

This backend is designed to run behind a TLS reverse proxy. The Bun process
should listen on a loopback or private interface, while the proxy is the only
public entry point.

This document is also the deployment contract for LGS1920 Studio and the
public Site. A security configuration is incomplete if it protects the backend
but leaves a client calling a private port, exposes a server token in browser
code, or mixes staging and production origins.

Until a local reverse proxy is available, the backend keeps its legacy
all-interface bind when `LGS1920_BACKEND_HOST` and `backend.host` are both
unset. Set `LGS1920_BACKEND_HOST=127.0.0.1` when the reverse proxy is ready.

## Environment configuration

Configure these variables separately for development, test, staging, and
production:

| Variable | Purpose |
| --- | --- |
| `LGS1920_BACKEND_HOST` | Bind address. Use `127.0.0.1` when a local reverse proxy is present. |
| `LGS1920_ALLOWED_ORIGINS` | Comma-separated exact browser origins. Include scheme and port when required. |
| `LGS1920_INTERNAL_API_TOKEN` | Server-only bearer token for protected internal routes. |
| `LGS1920_PUBLIC_HTTPS` | Enables HSTS when the public proxy terminates HTTPS. |
| `LGS1920_MAX_READ_FILE_BYTES` | Upper bound for protected local file reads. |
| `LGS1920_COUNT_DEFAULT_TIME_ZONE` | Fallback IANA time zone for count events that omit a browser time zone. |

Non-development deployments fail closed for protected routes when
`LGS1920_INTERNAL_API_TOKEN` is missing. The token must never be included in
Studio or Site browser bundles.

Example production settings:

```text
LGS1920_BACKEND_HOST=127.0.0.1
LGS1920_ALLOWED_ORIGINS=https://studio.lgs1920.fr,https://lgs1920.fr
LGS1920_INTERNAL_API_TOKEN=<server-only-random-token>
LGS1920_PUBLIC_HTTPS=true
LGS1920_MAX_READ_FILE_BYTES=5242880
```

Use a different token, data directory, log destination, and backend port for
each environment. Never copy a production token into staging, test, Studio,
Site, Git, or a generated browser bundle.

## CORS policy

CORS uses an exact origin allowlist. It does not authenticate requests and it
does not protect against direct requests made by command-line tools or other
servers.

Use environment-specific values, for example:

```text
production: https://studio.lgs1920.fr,https://lgs1920.fr
staging:    https://staging.lgs1920.fr
test:       https://test.lgs1920.fr
```

Do not use wildcard subdomains or plain HTTP origins in production.

The origin list must match the actual page origin, not the backend hostname.
For example, the Site calls the backend from `https://lgs1920.fr`, while
Studio calls it from `https://studio.lgs1920.fr`. If staging or test is served
from the same `lgs1920.fr` hostname as production, configure that exact origin
explicitly or, preferably, give each environment its own hostname. Reusing a
production origin for multiple environments weakens environment isolation.

## Route exposure

The aggregate `/count` routes remain browser-callable because Studio sends
anonymous events from the client and Site reads public statistics. If those
routes must become private, move the calls behind a server-side BFF and apply
the internal bearer token there.

The `/read` and `/convert` routes are internal-only and require the bearer
token outside local development. The file reader accepts only files below the
configured backend or Studio roots, rejects traversal, rejects remote URLs,
and enforces a size limit. Changelog file reads also reject traversal and
non-Markdown file names.

Count event payloads may include a browser-provided IANA `timeZone` value. The
backend validates this value and uses `LGS1920_COUNT_DEFAULT_TIME_ZONE` when it
is omitted, with UTC as the default. The value only provides calendar context
for aggregate periods; it is not used as an identity or authentication factor
and must not be logged.

The following routes remain browser-facing and do not require the internal
token:

- `GET /ping` and `GET /versions`, used by Studio startup and diagnostics.
- `GET /changelog/list` and `GET /changelog/read/:file`, used by Studio and the
  public changelog workflow.
- `POST /journey/import-url`, used by Studio journey import.
- `/cloud-auth/*`, whose account connection flow is not available yet.
- `/count/*`, used by anonymous Studio instrumentation and public Site
  statistics.

These routes still need proxy-level rate limits, input validation, and
monitoring. Browser reachability does not mean that they are trusted.

## Studio and Site compatibility

The security changes have the following client impact:

| Client | Current usage | Required deployment action |
| --- | --- | --- |
| Studio | Calls `ping`, `versions`, changelog, journey import, and `/count` from the browser | Keep these routes public, use the HTTPS backend proxy, and do not add the internal token to Studio. |
| Site | Calls `/count` to display public statistics | Keep `/count` public and set `LGS1920_COUNT_API_URL` to the public HTTPS proxy URL. |
| Any trusted server integration | May call `/read` or `/convert` | Send `Authorization: Bearer <server-token>` and keep the token server-side. |

Studio and Site must not call `http://api.lgs1920.fr:3333`,
`http://api.lgs1920.fr:3334`, or `http://api.lgs1920.fr:3335` from a public
browser. Those ports are backend process ports, not public API contracts. The
reverse proxy should expose the appropriate environment through an HTTPS URL,
for example `https://api.lgs1920.fr`, and forward internally to the selected
private port.

The existing Studio proxy configuration can continue to provide the browser
entry point. For the Site, local development may use a local backend URL, but
staging and production builds must use the HTTPS reverse-proxy URL. A direct
staging value such as `http://api.lgs1920.fr:3334` must be replaced before the
staging site is exposed publicly.

Do not protect `/count` with `LGS1920_INTERNAL_API_TOKEN` while it is called
directly by browser JavaScript. That would either break Studio and Site or
leak the token to every visitor. If `/count` must become private in the
future, introduce a server-side BFF or equivalent server integration and put
the token there.

## Reverse proxy and network requirements

- Expose only the reverse proxy on ports 80/443.
- Block direct public access to backend ports 3333, 3334, and 3335.
- Redirect HTTP to HTTPS and enable HSTS after HTTPS is verified.
- Protect staging and test with a VPN, an IP allowlist, or proxy-level
  authentication.
- Route each public environment to its own backend process, data directory,
  secret set, and log destination.
- Verify that Studio and Site use the proxy URL for their environment before
  blocking direct backend ports.
- Use separate hostnames, secrets, data directories, and logs for each
  environment.
- Run Bun as a dedicated unprivileged user.
- Disable process watch mode in production-like environments.

The reverse proxy should also provide request size limits, timeouts, and rate
limits. Application endpoints must still validate input and avoid exposing
upstream errors, local paths, or credentials.

The public contact API also applies an in-process rate limit of 10 token
requests and 5 message sends per client per 15 minutes. This is a safety net,
not a replacement for proxy-level rate limiting. Set
`LGS1920_TRUST_PROXY=true` only when the backend port is private and every
request comes through the trusted reverse proxy; otherwise the application
uses the direct socket address and ignores `X-Forwarded-For`.

### Activation when the reverse proxy is introduced

Complete the following transition before making the backend publicly
reachable through the proxy:

1. Provision the proxy with a certificate for the public API hostname and
   redirect HTTP to HTTPS.
2. Configure the proxy to forward only the intended public routes to the
   matching backend process and private port.
3. Set `LGS1920_BACKEND_HOST=127.0.0.1` when the proxy and backend share a host.
   When they use separate hosts or containers, use a private interface and
   firewall rules that allow the backend port only from the proxy.
4. Remember that `LGS1920_BACKEND_HOST` takes precedence over
   `backend.host`. If both are unset, the legacy fallback binds to `0.0.0.0`;
   this must not be the final public deployment configuration.
5. Set `LGS1920_PUBLIC_HTTPS=true`, update the exact HTTPS values in
   `LGS1920_ALLOWED_ORIGINS`, and restart the backend.
6. Change Studio and Site configuration to the public HTTPS proxy URL. Do not
   leave a direct backend port in a staging or production browser bundle.
7. Verify local proxy access, public-port blocking, CORS, protected-route
   authentication, public count access, and the separate staging and
   production data and secrets before opening public traffic.

## Deployment verification

Before switching an environment to the hardened configuration:

1. Confirm that the backend is reachable locally through the reverse proxy,
   but not through its private port from the public network.
2. Load Studio and verify `ping`, `versions`, changelog loading, journey
   import, and anonymous count events.
3. Load the Site and verify that public statistics can be read from the
   configured `LGS1920_COUNT_API_URL`.
4. Confirm that `/read` and `/convert` return `401` without a bearer token and
   succeed only with the matching server-side token.
5. Confirm that requests from an unlisted browser origin do not receive CORS
   permission.
6. Confirm that staging and test use their own token, backend process, data,
   logs, and access controls.

Example protected-route checks:

```bash
curl -i 'https://api.example.test/read?file=package.json'
curl -i -H "Authorization: Bearer ${LGS1920_INTERNAL_API_TOKEN}" \
  'https://api.example.test/read?file=package.json'
```

The first request must fail outside local development. The second request
must only be run from a trusted server or an administrator workstation where
the token is not recorded in shell history or CI logs.
