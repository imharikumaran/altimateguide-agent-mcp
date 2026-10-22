# Altimateguide Agent MCP Server

[![smithery badge](https://smithery.ai/badge/imharikumaran/altimateguide)](https://smithery.ai/servers/imharikumaran/altimateguide)

A small MCP server that lets an AI agent submit a tool to the
[Altimateguide](https://altimateguide.com) directory for editorial review — and,
optionally, earn it a dofollow link.

**Scope:** this server only talks to the public Altimateguide HTTP API. It holds
no database credentials and grants no access beyond submitting/owning listings.
Nothing is published without an editor reviewing it, and no submission can
self-grant a dofollow link — a paid listing only becomes a dofollow candidate
once its payment is verified server-side. Unverified listings stay nofollow and
are reviewed in 15–20 business days; verified and paid listings are reviewed in
2–7.

## Tools

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
| `get_submission` | Poll a submission's status (`GET /api/agent/submissions/{id}`). |
| `update_listing` | Edit the facts of a listing you own — only the fields you pass change (`PATCH /api/agent/listing/{slug}`). |
| `get_listing_stats` | Visits/upvotes/saves/reviews for your listings, with 7- and 30-day windows (`GET /api/agent/stats`). |
| `upgrade_listing` | Choose sayabout / badge / paid for a listing you own (`POST /api/agent/listing`). |

It also exposes the category list and the editorial policy as **resources**, a
`submit_listing` **prompt**, and category-slug **completions**. Server
`instructions` summarise the workflow for the model.

### `submit_tool` parameters

- `name` (string, required) — tool name
- `url` (string, required) — canonical http(s) URL
- `description` (string, optional) — neutral copy, min 20 chars
- `categories` (array, optional) — slugs from `list_categories`
- `categorySuggestions` (array, optional) — free-text hints when none fit (recorded for the reviewer)
- `features` (array, optional) — `{ label, description? }` items
- `pros` / `cons` (array, optional), `pricing` / `freePlan` / `freeTrial` (optional)
- `proof` (string, optional) — `none` (default) | `sayabout` | `badge`
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

Full request/response contract: <https://altimateguide.com/openapi.json>.

## Review times

Turnaround and link tier both come from `proof`:

| `proof` | Link | Review |
| --- | --- | --- |
| `paid` (via `upgrade_listing`) | dofollow | within 2 business days |
| `sayabout` | dofollow | within 2 business days |
| `badge` | dofollow | 5–7 business days |
| `none` (default) | nofollow | 15–20 business days |

Verified and paid submissions are reviewed ahead of unverified ones. The
`submit_tool` response includes `review_eta`; an unverified response also
includes an `upgrade` hint pointing at `upgrade_listing`, so an agent can
surface the faster dofollow paths to its user.

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
│   ├── index.ts        # stdio server: tool registry + resources/prompts/completions
│   ├── api.ts          # shared fetch client (timeout, retry, error mapping)
│   ├── auth.ts         # start_login / complete_login / whoami
│   ├── categories.ts   # list_categories + matching
│   ├── submit.ts       # submit_tool
│   ├── listing.ts      # check_duplicate / get_submission / upgrade_listing
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
  ones in [Tools](#tools) (`/api/auth/…`, `/api/agent/…`, `/openapi.json`). No
  telemetry and no third-party calls.
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
