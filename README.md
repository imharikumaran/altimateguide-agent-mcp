# Altimateguide Agent MCP Server

[![smithery badge](https://smithery.ai/badge/imharikumaran/altimateguide)](https://smithery.ai/servers/imharikumaran/altimateguide)

A small MCP server that lets an AI agent submit a tool to the
[Altimateguide](https://altimateguide.com) directory for editorial review. It
exposes exactly one tool: `submit_tool`.

**Scope:** this server only talks to the public Altimateguide HTTP API
(`POST /api/agent/submit`). It holds no database credentials and grants no
access to anything beyond submitting a listing — which is always queued for
human review and never published automatically.

## The tool: `submit_tool`

Submits a listing for editorial review. The submission lands as `pending`; an
editor reviews it.

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

## Install & use

```bash
npx -y altimateguide-agent-mcp        # run directly (stdio)
```

Or from a local checkout:

```bash
npm install
npm run build      # tsc -> dist/
npm run dev        # stdio server via tsx (for local testing)

npm run check      # tsc --noEmit
npm test           # vitest suite
npm run lint       # eslint
npm run bundle     # build a .mcpb (Smithery / Claude Desktop)
```

### Claude Desktop / other MCP clients

```json
{
  "mcpServers": {
    "altimateguide": {
      "command": "npx",
      "args": ["-y", "altimateguide-agent-mcp"],
      "env": {
        "ALTIMATEGUIDE_AGENT_TOKEN": "atg_..."
      }
    }
  }
}
```

(From a local checkout, use `"command": "node"` and
`"args": ["/absolute/path/to/dist/index.js"]`.)

## Registries

Listed via `server.json` (the MCP Registry manifest). It is a standard stdio
server, so it also works with the community directories (Glama, PulseMCP,
mcp.so, mcp.directory).

## Project structure

```
.
├── src/
│   ├── index.ts         # stdio MCP server: transport + request handlers
│   └── submit.ts         # submit_tool Zod schema, JSON Schema, and API call
├── test/                 # vitest suites (submit logic + manifest version sync)
├── scripts/
│   └── build-mcpb.mjs    # packs the .mcpb bundle
├── mcpb/
│   └── manifest.json     # Claude Desktop / Smithery bundle manifest
├── .github/workflows/
│   └── publish.yml       # npm publish via OIDC trusted publishing
├── server.json           # MCP Registry manifest
├── eslint.config.js
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT — see [LICENSE](./LICENSE).
