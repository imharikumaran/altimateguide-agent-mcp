import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";

/**
 * The MCP SDK puts an error's numeric `code` and bare `message` on the wire. But
 * `McpError`'s message getter prefixes "MCP error <code>: ", and the client then
 * prefixes it again — the doubled prefix. A plain Error carrying a numeric `code`
 * keeps the JSON-RPC code while sending an unprefixed message.
 */
export function toolError(code: number, message: string): Error {
    const error = new Error(message) as Error & { code: number };
    error.code = code;
    return error;
}

/**
 * Single source of truth for the tool's arguments: it both validates calls and
 * generates the `inputSchema` advertised to clients (see SUBMIT_TOOL below).
 */
export const SubmitToolSchema = z.object({
    name: z.string().min(1, "Tool name is required").describe("Tool name"),
    url: z
        .string()
        .url("A valid http(s) tool URL is required")
        .describe("Canonical http(s) URL of the tool"),
    description: z
        .string()
        .min(20, "Description must be at least 20 characters (neutral listing copy)")
        .optional()
        .describe(
            "Neutral listing copy (min 20 chars; promotional/ranking language is rejected)"
        ),
    categories: z
        .array(z.string().min(1))
        .min(1, "At least one category slug is required")
        .describe("One or more category slugs"),
    features: z
        .array(
            z.object({
                label: z.string().min(1).max(80),
                description: z.string().max(300).optional(),
            })
        )
        .optional()
        .describe("Structured feature list (label + optional detail)"),
    proof: z
        .enum(["none", "sayabout", "badge", "paid"])
        .optional()
        .describe(
            "Inclusion path (default none). sayabout (recommended) and badge need verificationUrl; paid needs paymentRef."
        ),
    verificationUrl: z.string().url().optional().describe("Required for sayabout/badge proof"),
    paymentRef: z.string().max(200).optional().describe("Required for paid proof"),
    externalId: z.string().max(200).optional().describe("Your own id for idempotent replays"),
    source: z
        .string()
        .regex(/^[a-z0-9][a-z0-9:_-]{1,63}$/, "source must be a lowercase id like agent:mcp")
        .optional()
        .describe("Origin id, e.g. agent:mcp"),
});

export type SubmitToolArgs = z.infer<typeof SubmitToolSchema>;

const inputSchema = zodToJsonSchema(SubmitToolSchema, { target: "jsonSchema7" }) as Record<
    string,
    unknown
>;
delete inputSchema.$schema;

export const SUBMIT_TOOL: Tool = {
    name: "submit_tool",
    description:
        "Submit a tool to the Altimateguide directory for editorial review " +
        "(POST /api/agent/submit). The listing is queued as pending and is never " +
        "published automatically — an editor reviews it. Requires " +
        "ALTIMATEGUIDE_AGENT_TOKEN, a per-account API token created at " +
        "https://altimateguide.com/account (Agent & API access).",
    inputSchema: inputSchema as Tool["inputSchema"],
};

export function apiBase(): string {
    return (process.env.ALTIMATEGUIDE_API_URL || "https://altimateguide.com").replace(/\/+$/, "");
}

export async function submitTool(args: SubmitToolArgs) {
    const token = process.env.ALTIMATEGUIDE_AGENT_TOKEN;
    if (!token) {
        throw toolError(
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
        throw toolError(
            ErrorCode.InternalError,
            `Could not reach the submission API at ${base}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
        throw toolError(
            ErrorCode.InvalidRequest,
            `Submission failed (${res.status}): ${String(data.error || "unknown error")}`
        );
    }

    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
