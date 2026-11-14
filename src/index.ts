#!/usr/bin/env node

/**
 * stdio entry point (npx altimateguide-agent-mcp).
 *
 * The tool surface lives in server.ts so the hosted HTTP transport and this bin
 * can never drift.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function run() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Altimateguide agent MCP server running (tools, resources, prompts).");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
