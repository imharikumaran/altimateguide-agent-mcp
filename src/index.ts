#!/usr/bin/env node

/**
 * Altimateguide agent MCP server (stdio transport).
 *
 * A public MCP server exposing one tool — `submit_tool` — which submits a
 * listing to the Altimateguide directory for editorial review via
 * `POST /api/agent/submit`. It has no database access; it authenticates to the
 * public API with a per-account bearer token, and nothing is published without
 * an editor reviewing it.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SUBMIT_TOOL, SubmitToolSchema, submitTool, toolError } from "./submit.js";

// Report the version from the package manifest — one source of truth, read
// relative to this file (works both from src/ under tsx and dist/ when installed).
const { version } = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")
) as { version: string };

const server = new Server(
    { name: "altimateguide-agent-mcp", version },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [SUBMIT_TOOL] }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        if (name !== "submit_tool") {
            throw toolError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
        return await submitTool(SubmitToolSchema.parse(args));
    } catch (error) {
        if (error instanceof z.ZodError) {
            throw toolError(ErrorCode.InvalidParams, `Invalid parameters: ${error.message}`);
        }
        throw error;
    }
});

async function run() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Altimateguide agent MCP server running (submit_tool).");
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
