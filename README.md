# Altimateguide Agent MCP Server

[![LightNow capabilities](https://lightnow.ai/badge/io.github.imharikumaran/altimateguide)](https://lightnow.ai/servers/io.github.imharikumaran/altimateguide)

The MCP server for [Altimateguide](https://altimateguide.com), an independent
software directory. It has two halves:

- **Research — no account.** Search tool profiles, compare two tools, find
  alternatives, and list live deals. Every result carries its canonical
  altimateguide.com URL.
- **Submission — with an account token.** Submit a tool to the directory for
  editorial review, add a time-boxed deal, and upgrade the listing. The **paid
  listing is the fastest route**: a one-time fee, reviewed within 2 business
  days, with no badge or wall to install.

The same server is available two ways: hosted over streamable HTTP at
`https://altimateguide.com/api/mcp`, or locally over stdio via `npx`. One tool
surface, one code path (`src/server.ts`).

**Scope:** this server only talks to the public Altimateguide HTTP API. It holds
no database credentials and grants no access beyond submitting/owning listings.
Nothing is published without an editor reviewing it, and no submission can
self-grant a dofollow link — a paid listing only becomes a dofollow candidate
once its payment is verified server-side. Paid and verified listings are reviewed
in 2–7 business days; free no-verification listings stay nofollow and are
reviewed within 30 days.

**Fastest route to dofollow:** submit the tool (with `proof: "none"` or omitted),
then call `upgrade_listing` with `path: "paid"`. It returns a Dodo checkout URL
for the human to complete, and the link becomes dofollow once the payment is
verified server-side. Read the current price and the recommended path from the
`altimateguide://listing-paths` resource.

## Tools

### Research (no account needed)

| Tool | What it does |
| --- | --- |
| `search_tools` | Search published tools by keyword, category or free plan (`GET /api/public/search`). |
| `get_tool` | Read one profile: pricing, free plan/trial, pros, cons, features, rating (`GET /api/public/tools/{slug}`). |
| `compare_tools` | Compare two tools, with the canonical `/vs/` page when one exists (`GET /api/public/compare`). |
| `find_alternatives` | Curated alternatives page first, then same-category tools (`GET /api/public/alternatives/{slug}`). |
| `list_deals` | Live lifetime deals, sales and launch offers (`GET /api/public/deals`). |

### Submission (account token)

| Tool | What it does |
| --- | --- |
| `start_login` | Email a one-time login code (`POST /api/auth/request-code`). |
| `complete_login` | Exchange the code for an account API token and store it (`POST /api/agent/token`). |
| `start_agentid_login` | Begin an AgentID sign-in with no email inbox — returns an `authorizeUrl` + `flowId` (`POST /api/agent/agentid/start`). |
| `complete_agentid_login` | Poll the AgentID sign-in and store the account token once it completes (`GET /api/agent/agentid/poll`). |
| `whoami` | Report whether a token is configured locally. |
| `list_categories` | The valid category slugs (`GET /api/agent/categories`). |
| `check_duplicate` | Preflight a name/URL against published tools + the pending queue (`GET /api/agent/check`). |
| `submit_tool` | Submit a listing for editorial review (`POST /api/agent/submit`). |
| `submit_deal` | Submit a time-boxed deal — lifetime deal, sale, or launch offer (`POST /api/agent/deals`). |
| `get_submission` | Poll a submission's status (`GET /api/agent/submissions/{id}`). |
| `update_listing` | Edit the facts of a listing you own — only the fields you pass change (`PATCH /api/agent/listing/{slug}`). |
| `get_listing_stats` | Visits/upvotes/saves/reviews for your listings, with 7- and 30-day windows (`GET /api/agent/stats`). |
| `upgrade_listing` | Choose paid (fastest — returns a checkout URL), sayabout, or badge for a listing you own (`POST /api/agent/listing`). |

It also exposes the category list, the editorial policy, and the listing
paths/pricing (with the recommended path) as **resources**, a `submit_listing`
**prompt**, and category-slug **completions**. Server `instructions` summarise
the workflow for the model.

### `submit_tool` parameters

- `name` (string, required) — tool name
- `url` (string, required) — canonical http(s) URL
- `description` (string, optional) — neutral copy, min 20 chars
- `categories` (array, optional) — slugs from `list_categories`
- `categorySuggestions` (array, optional) — free-text hints when none fit (recorded for the reviewer)
- `features` (array, optional) — `{ label, description? }` items
- `pros` / `cons` (array, optional), `pricing` / `freePlan` / `freeTrial` (optional)
- `proof` (string, optional) — `none` (default; free, no verification, nofollow) | `sayabout` | `badge`
- `verificationUrl` (string) — required for `sayabout`/`badge`
- `externalId` (string, optional) — your id for idempotent replays (derived from the URL when omitted)
- `source` (string, optional) — origin id (default `agent:mcp`)
- `resubmit` (boolean, optional) — set `true` to send a fresh copy after a previous
  submission for this URL was rejected (mints a new idempotency key instead of
  replaying the rejected row)

**Categories are optional.** An unknown or missing category never fails the
submission — it is recorded for the reviewer, exactly like the site's feed
pipeline. **Paid** (dofollow) listings are not submitted here; use
`upgrade_listing` with `path: "paid"`, which returns a Dodo checkout URL whose
payment is verified server-side.

### `submit_deal` parameters

A deal is a **time-boxed offer attached to a listing** — a lifetime deal, a sale,
or a launch price. It is separate from the listing itself: it never changes the
link tier, and it only appears on <https://altimateguide.com/deals> once
approved.

- `name` (string, required) — product name
- `url` (string, required) — canonical product URL (matched to a listing by domain)
- `dealUrl` (string, required) — the page documenting the offer; review verifies the price and dates against it
- `price` (number, required) — current offer price in USD
- `kind` (string, required) — `ltd` | `sale` | `launch`
- `billing` (string, optional) — `one-time` (default) | `month` | `year`
- `wasPrice` (number, optional) — pre-deal price, shown struck through
- `endsAt` (string, optional) — `YYYY-MM-DD`; **omit it for an open-ended offer**
- `tiers` (array, optional) — `{ name, codes? }` items
- `description` (string, optional) — "what's included", shown on the deals hub
- `categories` (array, optional) — slugs for an unlisted product
- `paymentRef` (string, optional) — a paid listing's payment ref → priority lane
- `externalId` (string, optional) — idempotency key (derived from the URLs when omitted)
- `source` (string, optional) — origin id (default `agent:mcp`)

Deal review: **free within 7 calendar days**, **priority within 2 business days**
with `paymentRef`. The response carries `review_eta`, `needs_listing` (true when
the product is not listed yet) and `link_tier: "unchanged"`. Open-ended offers
(no `endsAt`) stay live while their last verification is under 30 days old.

Full request/response contract: <https://altimateguide.com/openapi.json>.

## Review times

Turnaround and link tier both come from `proof`:

| `proof` | Link | Review |
| --- | --- | --- |
| `paid` (via `upgrade_listing`) | dofollow | within 2 business days |
| `sayabout` | dofollow | within 2 business days |
| `badge` | dofollow | 5–7 business days |
| `none` (default) | nofollow | within 30 days |

`none` is the free no-verification lane — the same one a human can request at
<https://altimateguide.com/free-listing>. Paid and verified submissions are
reviewed ahead of free no-verification ones. Both the `submit_tool` response and
`get_submission` include an `upgrade` hint while a submission is in the free
no-verification lane (still nofollow):
`recommended: "paid"` (with the current `price_usd`) plus the free `sayabout` /
`badge` alternatives. Surface that to the user before they settle for nofollow.
The response also carries `review_eta` (`unit` is `calendar_days` for `none`,
`business_days` otherwise).

## Configuration

- `ALTIMATEGUIDE_AGENT_TOKEN` — optional. An account API token (create at
  <https://altimateguide.com/account>, or mint one with the `complete_login`
  tool). When set, it takes precedence over the stored token.
- `ALTIMATEGUIDE_API_URL` — optional; overrides the API base (default
  `https://altimateguide.com`).
- `ALTIMATEGUIDE_CONFIG_DIR` — optional; where `complete_login` stores the token
  (default `~/.config/altimateguide`).

## Install & use

```bash
npx -y altimateguide-agent-mcp        # run directly (stdio)
```

### Remote (streamable HTTP)

The hosted endpoint needs no install and no token for the research tools:

```
https://altimateguide.com/api/mcp
```

```json
{
  "mcpServers": {
    "altimateguide": {
      "type": "http",
      "url": "https://altimateguide.com/api/mcp"
    }
  }
}
```

Per-client setup (Claude Code, Codex, Gemini CLI, VS Code, Cursor, Claude,
ChatGPT): <https://altimateguide.com/mcp/install>.

The hosted endpoint exposes the **research tools only** (`search_tools`, `get_tool`,
`compare_tools`, `find_alternatives`, `list_deals`, `list_categories`). Submission
tools read a token from the server process — on a shared host that would mean acting
as the deployment's account — so they stay on the local stdio server until OAuth
gives each caller its own credential. `createServer({ hosted: true })` enforces this.

The transport is **stateless** — no session id, JSON responses instead of SSE — so
it runs behind serverless functions without sticky routing.

To run the HTTP transport yourself:

```bash
npm run dev:http     # tsx, :3000
npm run build && npm run serve
```

Or from a local checkout:

```bash
npm install
npm run build      # tsc -> dist/
npm run dev        # stdio server via tsx (for local testing)
```

### Claude Desktop / other MCP clients

```json
{
  "mcpServers": {
    "altimateguide": {
      "command": "npx",
      "args": ["-y", "altimateguide-agent-mcp"]
    }
  }
}
```

The token can be supplied via `env.ALTIMATEGUIDE_AGENT_TOKEN`, or obtained at
runtime by calling `start_login` + `complete_login` (the agent needs access to
the mailbox it registers).

(From a local checkout, use `"command": "node"` and
`"args": ["/absolute/path/to/dist/index.js"]`.)

## Development

```bash
npm run check   # tsc --noEmit
npm run lint    # eslint
npm test        # vitest
npm run build   # tsc -> dist/
npm run bundle  # build a .mcpb (Smithery / Claude Desktop)
```

## Registries

Listed via `server.json` (the MCP Registry manifest). It is a standard stdio
server, so it also works with the community directories (Glama, PulseMCP,
mcp.so, mcp.directory).

## Project structure

```
.
├── src/
│   ├── server.ts       # createServer(): tools, resources, prompts, completions (one surface)
│   ├── index.ts        # stdio entry (the npx bin)
│   ├── http.ts         # streamable HTTP entries: web-standard + node
│   ├── read.ts         # public read tools (no auth)
│   ├── api.ts          # shared fetch client (timeout, retry, error mapping)
│   ├── auth.ts         # start_login / complete_login / whoami
│   ├── categories.ts   # list_categories + matching
│   ├── submit.ts       # submit_tool
│   ├── deal.ts         # submit_deal
│   ├── listing.ts      # check_duplicate / get_submission / upgrade_listing
│   ├── update.ts       # update_listing
│   ├── stats.ts        # get_listing_stats
│   ├── credentials.ts  # token storage (~/.config/altimateguide)
│   ├── schema.ts       # zod -> JSON Schema helper
│   └── version.ts      # package version
├── test/               # vitest
├── server.json         # MCP Registry manifest
├── mcpb/manifest.json  # .mcpb bundle manifest
├── package.json
└── tsconfig.json
```

## Security & permissions

This server is a thin, local client for the public Altimateguide HTTP API — no
database access, no subprocess, no background work. The capabilities below are
the entire surface (the same surface a supply-chain scanner reports):

- **Network** — outbound HTTPS only, to the base in `ALTIMATEGUIDE_API_URL`
  (default `https://altimateguide.com`). The endpoints it calls are exactly the
  ones in [Tools](#tools) (`/api/public/…`, `/api/auth/…`, `/api/agent/…`,
  `/openapi.json`). No telemetry and no third-party calls.
- **Environment variables** — reads `ALTIMATEGUIDE_AGENT_TOKEN`,
  `ALTIMATEGUIDE_API_URL`, and `ALTIMATEGUIDE_CONFIG_DIR`. Nothing is written
  back.
- **Filesystem** — one file: the account token at
  `${ALTIMATEGUIDE_CONFIG_DIR:-~/.config/altimateguide}/credentials.json`,
  created with mode `0600`. No other paths are touched.
- **No subprocess, no database** — it never spawns a process and holds no
  database credentials.

Credentials: an `ALTIMATEGUIDE_AGENT_TOKEN` environment variable always takes
precedence over the stored file, so CI-style setups can inject a token without
writing to disk.

Nothing is published without editorial review, and a paid listing only becomes a
dofollow candidate once its payment is verified server-side.

## License

MIT — see [LICENSE](./LICENSE).
