# ravi-db — GoHighLevel pipeline dashboard

Pulls a GoHighLevel pipeline through the **API v2 (LeadConnector)** and reports,
for every opportunity in it:

- **inbound and outbound call counts** (plus answered/missed and talk time)
- **form submissions** attached to the opportunity's contact
- **the lead source**, resolved from opportunity source and contact attribution

Output is three files: a self-contained HTML dashboard, a CSV for spreadsheets,
and the full JSON dataset.

No runtime dependencies — Node 20.6+ and the built-in `fetch`.

## Setup

1. In the GoHighLevel **sub-account**, go to *Settings → Private Integrations*
   and create a token with these scopes:

   | Scope | Used for |
   |---|---|
   | `opportunities.readonly` | pipelines and opportunities |
   | `contacts.readonly` | lead source / UTM attribution |
   | `conversations.readonly` | finding each contact's conversations |
   | `conversations/message.readonly` | reading call messages |
   | `forms.readonly` | form submissions |

2. Copy `.env.example` to `.env` and fill in the token and location id:

   ```bash
   cp .env.example .env
   ```

## Usage

```bash
# Find the pipeline you want
node bin/ghl-report.js pipelines

# Build the dashboard
node bin/ghl-report.js report --pipeline "Sales Pipeline"

# Narrow to a date range and write somewhere else
node bin/ghl-report.js report --pipeline-id abc123 \
  --start 2026-01-01 --end 2026-06-30 --out ./reports
```

This writes `out/<pipeline-slug>.html`, `.csv` and `.json`. Open the HTML file
directly in a browser — it has no external assets and works offline.

To see the layout without credentials:

```bash
npm run demo   # writes out/demo.html from synthetic data
```

### Options

| Flag | Meaning |
|---|---|
| `--pipeline <name>` | Pipeline name, case-insensitive |
| `--pipeline-id <id>` | Pipeline id; wins over `--pipeline` |
| `--start` / `--end` | Filter by opportunity **creation** date (`YYYY-MM-DD`) |
| `--out <dir>` | Output directory (default `./out`) |
| `--currency <code>` | ISO currency for money formatting (default `USD`) |
| `--concurrency <n>` | Contacts processed in parallel (default 4) |
| `--no-calls` | Skip call data — much faster |
| `--no-forms` | Skip form submissions |
| `--no-attribution` | Skip the per-contact fetch; use `opportunity.source` only |
| `--cache` | Reuse cached API responses from `.cache` |
| `--quiet` | No progress output |

## What the numbers mean

**Calls.** For each opportunity's contact, every conversation is read and its
messages filtered to `messageType: TYPE_CALL`. `direction` gives inbound vs
outbound; `callStatus` gives answered vs missed; `callDuration` gives talk time.

**Form submissions.** Fetched location-wide in one pass and indexed by
`contactId`, then joined onto opportunities.

**Double counting.** Calls and form submissions belong to a *contact*, not an
opportunity. If one contact has two opportunities in the pipeline, the detail
table shows that contact's calls on both rows — which is what you want when
reading a single opportunity — but the totals and the per-source bars count
each contact only once, so the headline numbers are not inflated. The
Opportunities tile shows the distinct contact count, and `duplicateContacts` in
the JSON says how many rows shared a contact with an earlier row.

**Lead source.** Resolved in this order, first non-empty wins:

1. `opportunity.source` — usually set deliberately by the workflow or user that created it
2. `contact.attributionSource.utmSource`
3. `contact.attributionSource.sessionSource`
4. the host of `contact.attributionSource.referrer`
5. `contact.source`
6. otherwise `Unknown`

Every row records which of these it came from in `lead_source_resolved_from`, so
you can see how much of the report rests on automatic attribution versus a field
someone set by hand. Sources are also bucketed into channels (Paid, Social,
Search, Referral, Direct, Other) for the rollup.

**Date filtering** is applied client-side on `createdAt` after fetching the
pipeline, so `--start`/`--end` never silently drop opportunities because of a
server-side filter mismatch.

## Cost and rate limits

The expensive part is calls: roughly **two API requests per opportunity** (one
conversation search, one message fetch) plus one per contact for attribution. A
600-opportunity pipeline is about 1,800 requests — a few minutes under
HighLevel's burst limit of 100 requests per 10 seconds per location, which the
client enforces with a token bucket. 429s and 5xx are retried with exponential
backoff, honouring `Retry-After`.

To iterate on the report without re-hitting the API, run with `--cache`.
For a quick pipeline-shape check, `--no-calls` cuts almost all the traffic.

## Layout

```
bin/ghl-report.js      CLI entry point
src/cli.js             Argument parsing, output files
src/report.js          Orchestration: joins opportunities to calls/forms/source
src/aggregate.js       Rollups by source, channel, stage, status, month
src/leadSource.js      Lead source resolution and channel classification
src/ghl/client.js      Auth, rate limiting, retries, caching
src/ghl/*.js           One module per API area
src/render/            HTML dashboard and CSV output
test/                  Unit tests plus an end-to-end run against a mock API
```

## Tests

```bash
npm test
```

The end-to-end tests run the whole report path against an in-memory GoHighLevel
stub, covering cursor pagination, the fallbacks, and HTML/CSV rendering.
