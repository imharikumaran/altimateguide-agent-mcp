# Altimateguide Agent MCP Server

A small, **public** MCP server that lets an AI agent submit a tool to the
Altimateguide directory for editorial review. One tool: `submit_tool`.

## How this differs from the internal MCP

There are two MCP servers in this project, with different audiences — keep them
separate:

| | `agent-mcp/` (this) | `mcp-server/` |
| --- | --- | --- |
| Audience | AI agents / MCP clients (public) | Operators only (local, gitignored) |
| Purpose | Submit a tool to the live directory | impact.com ingestion + content management |
| Tools | `submit_tool` | `read_tool_data`, `create_tool_entry`, `pull_affiliate_offers`, … |
| Data access | None — calls the public HTTP API | Full Postgres read/write |
| Auth | Per-account API token | `DATABASE_URL` / impact.com credentials |

An agent should only ever be given **this** server. The ops server (`mcp-server/`)
is the operator's commerce/content tooling and must not be exposed to agents.

## The tool: `submit_tool`

Submits a listing via `POST /api/agent/submit`. The submission is queued as
`pending` and is **never published automatically** — an editor reviews it in
`/manage/submissions`.

- **Parameters**
  - `name` (string, required) — tool name
  - `url` (string, required) — canonical http(s) URL
  - `categories` (array, required) — one or more category slugs
  - `description` (string, optional) — neutral copy, min 20 chars
  - `features` (array, optional) — `{ label, description? }` items
  - `proof` (string, optional) — `none` (default) | `sayabout` | `badge` | `paid`
  - `verificationUrl` (string) — required for `sayabout`/`badge`
  - `paymentRef` (string) — required for `paid`
  - `externalId` (string, optional) — your own id, for idempotent replays
  - `source` (string, optional) — origin id (default `agent:mcp`)
- **Returns** — the API response: `submission_id`, `status`, `proof`, `link_tier`.

Full request/response contract: <https://altimateguide.com/openapi.json>.

## Configuration

- `ALTIMATEGUIDE_AGENT_TOKEN` — **required.** A per-account API token. Create one
  at <https://altimateguide.com/account> (Agent & API access); it is bound to that
  account, shows as the submitter, and can be revoked.
- `ALTIMATEGUIDE_API_URL` — optional; overrides the API base (default
  `https://altimateguide.com`).

## Running it

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
      "command": "node",
      "args": ["/absolute/path/to/altimateguide/agent-mcp/dist/index.js"],
      "env": {
        "ALTIMATEGUIDE_AGENT_TOKEN": "atg_..."
      }
    }
  }
}
```

## MCP registries

This is a standard stdio MCP server and can be listed in the MCP directories
(Smithery, Glama, mcp.so, PulseMCP, `awesome-mcp-servers`). A `smithery.yaml` is
included for Smithery. Build first (`npm run build`); the stdio entry is
`dist/index.js`.

## Project structure

```
agent-mcp/
├── src/index.ts     # stdio MCP server + the submit_tool handler
├── package.json
├── tsconfig.json
├── smithery.yaml
└── README.md
```
