#!/usr/bin/env node

/**
 * Altimateguide agent MCP server (stdio transport).
 *
 * PUBLIC, agent-facing surface: one tool — `submit_tool` — which submits a
 * listing to the Altimateguide directory for editorial review via
 * `POST /api/agent/submit`.
 *
 * This is deliberately separate from the internal ops MCP in `mcp-server/`
 * (impact.com ingestion + content management): that one is local-only and
 * reads/writes Postgres; this one has no database access and authenticates to
 * the public API with a per-account token. Keep the two apart — agents should
 * never see the ops tools.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const SubmitToolSchema = z.object({
    name: z.string().min(1, "Tool name is required"),
    url: z.string().url("A valid http(s) tool URL is required"),
    description: z
        .string()
        .min(20, "Description must be at least 20 characters (neutral listing copy)")
        .optional(),
    categories: z.array(z.string().min(1)).min(1, "At least one category slug is required"),
    features: z
        .array(
            z.object({
                label: z.string().min(1).max(80),
                description: z.string().max(300).optional(),
            })
        )
        .optional(),
    proof: z.enum(["none", "sayabout", "badge", "paid"]).optional(),
    verificationUrl: z.string().url().optional(),
    paymentRef: z.string().max(200).optional(),
    externalId: z.string().max(200).optional(),
    source: z
        .string()
        .regex(/^[a-z0-9][a-z0-9:_-]{1,63}$/, "source must be a lowercase id like agent:mcp")
        .optional(),
});

const SUBMIT_TOOL = {
    name: "submit_tool",
    description:
        "Submit a tool to the Altimateguide directory for editorial review " +
        "(POST /api/agent/submit). The listing is queued as pending and is never " +
        "published automatically — an editor reviews it. Requires " +
        "ALTIMATEGUIDE_AGENT_TOKEN, a per-account API token created at " +
        "https://altimateguide.com/account (Agent & API access).",
    inputSchema: {
        type: "object",
        properties: {
            name: { type: "string", description: "Tool name" },
            url: { type: "string", description: "Canonical http(s) URL of the tool" },
            description: {
                type: "string",
                description:
                    "Neutral listing copy (min 20 chars; promotional/ranking language is rejected)",
            },
            categories: {
                type: "array",
                items: { type: "string" },
                description: "One or more category slugs",
            },
            features: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        label: { type: "string" },
                        description: { type: "string" },
                    },
                    required: ["label"],
                },
                description: "Structured feature list (label + optional detail)",
            },
            proof: {
                type: "string",
                enum: ["none", "sayabout", "badge", "paid"],
                description:
                    "Inclusion path (default none). sayabout/badge need verificationUrl; paid needs paymentRef.",
            },
            verificationUrl: {
                type: "string",
                description: "Required for sayabout/badge proof",
            },
            paymentRef: { type: "string", description: "Required for paid proof" },
            externalId: {
                type: "string",
                description: "Your own id for idempotent replays",
            },
            source: { type: "string", description: "Origin id, e.g. agent:mcp" },
        },
        required: ["name", "url", "categories"],
    },
};

function apiBase(): string {
    return (process.env.ALTIMATEGUIDE_API_URL || "https://altimateguide.com").replace(/\/+$/, "");
}

async function submitTool(args: z.infer<typeof SubmitToolSchema>) {
    const token = process.env.ALTIMATEGUIDE_AGENT_TOKEN;
    if (!token) {
        throw new McpError(
            ErrorCode.InvalidRequest,
            "ALTIMATEGUIDE_AGENT_TOKEN is not set. Create an account API token at " +
                "https://altimateguide.com/account (Agent & API access)."
        );
    }

    const payload = {
        source: args.source || "agent:mcp",
        external_id: args.externalId,
        proof: args.proof || "none",
        verification_url: args.verificationUrl,
        payment_ref: args.paymentRef,
        listing: {
            name: args.name,
            url: args.url,
            description: args.description,
            categories: args.categories,
            features: args.features,
        },
    };

    const base = apiBase();
    let res: Response;
    try {
        res = await fetch(`${base}/api/agent/submit`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });
    } catch (error) {
        throw new McpError(
            ErrorCode.InternalError,
            `Could not reach the submission API at ${base}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
        throw new McpError(
            ErrorCode.InvalidRequest,
            `Submission failed (${res.status}): ${String(data.error || "unknown error")}`
        );
    }

    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new Server(
    { name: "altimateguide-agent-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [SUBMIT_TOOL] }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        if (name !== "submit_tool") {
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
        return await submitTool(SubmitToolSchema.parse(args));
    } catch (error) {
        if (error instanceof z.ZodError) {
            throw new McpError(ErrorCode.InvalidParams, `Invalid parameters: ${error.message}`);
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
