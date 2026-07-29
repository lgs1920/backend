# Backend Count API — Flat-File Architecture Analysis

## Status

Approved direction pending implementation.

## Scope

This document defines the storage and API direction for [backend#18](https://github.com/lgs1920/backend/issues/18), the event instrumentation in [studio#399](https://github.com/lgs1920/studio/issues/399), and the statistics page in [site#2](https://github.com/lgs1920/site/issues/2).

## Decision

Use one compact JSON flat file as the backend persistence store.

The service keeps the current aggregate counters in memory and updates them in real time. It also keeps historical aggregate rows for every day, week, month, and year. The file is persisted once per day through an atomic replacement.

The file stores aggregate counters only. It never stores individual events, IP addresses, cookies, tokens, hashes, or visitor identities.

This solution is appropriate for one Bun backend process and low to moderate traffic. SQLite becomes preferable if the backend is deployed with multiple writers or if event volume makes full-file rewrites expensive.

## Privacy and counting rules

The API has no visitor identity concept.

- Do not read, store, or hash an IP address for counting.
- Do not issue or require cookies.
- Do not issue or require client tokens.
- Do not calculate unique visitor counts.
- Do not deduplicate events.
- Increment every accepted event independently.

Two successful journey loads from the same user produce two journey events and increment all relevant counters twice.

## Event endpoints

The backend accepts these event requests:

```text
POST /count/visit
POST /count/journey
POST /count/video/draft
POST /count/video/hq
```

Each POST request performs the following work in the mutation queue:

1. resolve the current UTC day, week, month, and year keys
2. create missing aggregate rows
3. increment the lifetime `total` row
4. increment the current `daily` row
5. increment the current `weekly` row
6. increment the current `monthly` row
7. increment the current `yearly` row
8. return the updated counters

The POST request is the only place where period rollover and counter updates occur.

## Read endpoints

The backend exposes these read endpoints:

```text
GET /count
GET /count/<item>
GET /count/<item>/<period>
GET /count/daily
GET /count/daily/<dd-mm-yyyy>
GET /count/weekly
GET /count/weekly/<yyyy-Www>
GET /count/monthly
GET /count/monthly/<mm-yy>
GET /count/yearly
GET /count/yearly/<yyyy>
```

When a date, month, year, or week parameter is omitted, the current UTC period is used.

Supported items are:

- `total`
- `visits`
- `journeys`
- `videos`

Supported periods are:

- `total`
- `daily`
- `weekly`
- `monthly`
- `yearly`

For `videos`, the row contains separate `draft` and `hq` counters.

GET handlers are read-only. They must not calculate aggregates, perform period rollover, increment counters, or write the file.

## Stored JSON model

Recommended path:

```text
<backendHome>/data/count.json
```

The root object stores the lifetime row and maps of aggregate rows:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-07-29T12:34:56.000Z",
  "total": {
    "visits": 1200,
    "journeys": 340,
    "videos": {
      "draft": 80,
      "hq": 25
    }
  },
  "daily": {
    "29-07-2026": {
      "visits": 12,
      "journeys": 4,
      "videos": {
        "draft": 2,
        "hq": 1
      }
    }
  },
  "weekly": {
    "2026-W31": {
      "visits": 90,
      "journeys": 20,
      "videos": {
        "draft": 12,
        "hq": 4
      }
    }
  },
  "monthly": {
    "07-26": {
      "visits": 400,
      "journeys": 110,
      "videos": {
        "draft": 25,
        "hq": 9
      }
    }
  },
  "yearly": {
    "2026": {
      "visits": 1200,
      "journeys": 340,
      "videos": {
        "draft": 80,
        "hq": 25
      }
    }
  }
}
```

The example uses the requested date formats:

- daily: `dd-mm-yyyy`
- monthly: `mm-yy`
- yearly: `yyyy`
- weekly: ISO week key `yyyy-Www`

The current period is identified by its map key. No separate event history is required.

## Persistence and real-time behavior

At startup, the backend loads and validates the JSON file into memory. POST requests mutate the in-memory snapshot immediately. GET requests return the current in-memory snapshot without recomputing it.

A daily persistence task writes the complete snapshot to a temporary file in the same directory and renames it over the target file. Controlled shutdown should trigger an additional save when possible.

Atomic rename prevents a partially written JSON file. The in-process FIFO queue prevents lost updates between concurrent POST requests.

Because the file is saved once per day, a process crash can lose events accepted after the last save. This is the explicit durability trade-off for the small file and low write frequency.

Missing files must be initialized with empty aggregate maps. Invalid files must be rejected safely and replaced with a valid zeroed snapshot or a last-known-good backup.

## Period semantics

All period keys use UTC calendar periods:

| Period | Key | Meaning |
|---|---|---|
| `total` | `total` | Lifetime event aggregate |
| `daily` | `dd-mm-yyyy` | One UTC calendar day |
| `weekly` | `yyyy-Www` | One UTC calendar week |
| `monthly` | `mm-yy` | One UTC calendar month |
| `yearly` | `yyyy` | One UTC calendar year |

Period rows are created and incremented by POST requests. GET requests never create missing rows or reset counters.

## Size estimate

The file grows with the number of retained periods, not with the number of events. With four counters per row and compact JSON, a daily row is approximately 100 bytes.

Estimated storage:

| Retention | Estimated compact JSON size |
|---|---:|
| 1 year | 40–60 KB |
| 10 years | 0.5–1 MB |
| 50 years | 2.5–5 MB |
| 100 years | 5–10 MB |

Monthly and yearly rows add only a small amount compared with daily rows. Pretty-printed JSON increases the size but remains within the same order of magnitude.

The service rewrites the complete file during the daily save. This is acceptable for a file of a few megabytes. If the file becomes materially larger, split storage by year or move to SQLite.

## Concurrency and deployment limit

The FIFO queue protects only one backend process. Two processes or containers writing the same file can overwrite each other even when each process has its own queue.

The deployment must therefore guarantee one active writer. If multiple writers become necessary, use SQLite or a shared database rather than extending the JSON queue with ad hoc locks.

## Proposed backend structure

The implementation can follow the existing Bun/Elysia resource and controller layout:

```text
src/resources/CountResource.js
src/controllers/CountController.js
src/services/CountStore.js
src/services/CountQueue.js
src/utils/CountSchema.js
tests/count/
```

Responsibilities:

- `CountResource`: register and validate HTTP routes
- `CountController`: expose read-only GET handlers and event POST handlers
- `CountQueue`: serialize POST mutations
- `CountStore`: load, validate, increment, create period rows, and persist the snapshot
- `CountSchema`: validate stored rows and public response data

The store should receive the resolved backend home path rather than importing the application entry point. This avoids adding another circular dependency to the backend structure.

## Testing requirements

The backend test script must run real Bun tests against a temporary backend home.

Minimum coverage:

- empty file initialization
- corrupted file recovery
- JSON schema validation
- every POST event route
- total, daily, weekly, monthly, and yearly increments
- daily, monthly, and yearly date lookups
- default current-period lookups
- repeated events from the same user are counted independently
- GET requests do not mutate or recalculate data
- daily persistence
- controlled-shutdown persistence
- atomic replacement behavior
- serialized concurrent POST requests
- no identity data in stored files or public responses

## Recommendation

Approve the flat JSON file for the first release under these conditions:

- one backend writer
- compact aggregate rows only
- daily persistence accepted as the durability policy
- UTC calendar periods
- no unique visitor requirement

Move to SQLite if multi-process deployment, high traffic, or stronger crash durability becomes necessary.

## Relation to the tracked issues

- [backend#18](https://github.com/lgs1920/backend/issues/18) owns the API, aggregate storage, period lookups, and backend tests.
- [studio#399](https://github.com/lgs1920/studio/issues/399) owns the four fire-and-forget event calls and sends no identity data.
- [site#2](https://github.com/lgs1920/site/issues/2) owns the `/stats` page and reads the stored aggregates only.
