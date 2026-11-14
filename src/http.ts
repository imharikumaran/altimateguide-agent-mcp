/**
 * HTTP entries for the same server.
 *
 * Two shapes, both stateless (no session id, JSON responses instead of SSE) so
 * they run behind serverless functions without sticky routing:
 *
 *   handleFetchRequest(request)   → Web `Request`/`Response` (Astro, Workers, Deno, Vercel edge)
 *   handleNodeRequest(req, res)   → Node `IncomingMessage`/`ServerResponse`
 *
 * `npm run serve` starts the Node listener on :3000 for local smoke tests.
 */
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "./server.js";

const MCP_PATH = "/mcp";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

/** What a hosted instance may do. See CreateServerOptions. */
export interface HttpOptions {
  hosted?: boolean;
}

/** Serve one MCP request as a web-standard Response. */
export async function handleFetchRequest(
  request: Request,
  options: HttpOptions = {}
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createServer({ hosted: options.hosted });
  await server.connect(transport);

  try {
    const response = await transport.handleRequest(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } finally {
    // Stateless: the JSON body is fully materialised, so the transport and its
    // server are done with this request.
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

/** Serve one MCP request on a Node server response. */
export async function handleNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: HttpOptions = {}
): Promise<void> {
  for (const [key, value] of Object.entries(CORS_HEADERS)) res.setHeader(key, value);
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createServer({ hosted: options.hosted });
  res.on("close", () => {
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

function healthBody() {
  return {
    status: "ok",
    service: "altimateguide-agent-mcp",
    transport: "streamable-http",
    endpoint: MCP_PATH,
    timestamp: new Date().toISOString(),
  };
}

/** Start a local HTTP listener (development / self-hosted). */
export function startServer(port = Number(process.env.PORT || 3000)) {
  const server = createHttpServer(async (req, res) => {
    const path = (req.url || "/").split("?")[0];
    if (path === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(healthBody()));
      return;
    }
    if (path !== MCP_PATH) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Not found: ${path}. MCP endpoint is ${MCP_PATH}.` }));
      return;
    }
    try {
      await handleNodeRequest(req, res);
    } catch (error) {
      console.error("MCP request failed:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  });

  server.listen(port, () => {
    console.log(`Altimateguide MCP server (streamable HTTP) on http://localhost:${port}${MCP_PATH}`);
    console.log(`Health check: http://localhost:${port}/health`);
  });
  return server;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  startServer();
}
