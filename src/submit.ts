/**
 * `submit_tool` — submit a listing for editorial review.
 *
 * The zod schema is both the validator and the source of the advertised
 * inputSchema (see inputSchemaFor). Categories are optional and any
 * non-matching guess can ride in `categorySuggestions`, so a missing/unknown
 * category never blocks a submission. `paid` is deliberately not accepted here:
 * a paid (dofollow) upgrade goes through `upgrade_listing` + the Dodo checkout,
 * where the payment is verified server-side.
 */
import { createHash } from "node:crypto";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { apiRequest } from "./api.js";
import { inputSchemaFor } from "./schema.js";
import { VERSION } from "./version.js";

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
    .describe("Neutral listing copy (min 20 chars; ranking language is rejected)"),
  categories: z
    .array(z.string().min(1))
    .optional()
    .describe("Category slugs — call list_categories to get valid ones"),
  categorySuggestions: z
    .array(z.string().max(60))
    .optional()
    .describe(
      "Free-text category hints when none of the real slugs fit; recorded for the reviewer"
    ),
  features: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        description: z.string().max(300).optional(),
      })
    )
    .optional()
    .describe("Structured feature list (label + optional detail)"),
  pros: z.array(z.string()).optional().describe("Short editorial pros"),
  cons: z.array(z.string()).optional().describe("Short editorial cons"),
  pricing: z
    .object({
      amount: z.number().positive(),
      currency: z.literal("USD"),
      period: z.enum(["month", "year", "one-time"]),
    })
    .optional()
    .describe("Starting price (USD)"),
  freePlan: z.boolean().optional().describe("Offers a free plan"),
  freeTrial: z.boolean().optional().describe("Offers a free trial"),
  proof: z
    .enum(["none", "sayabout", "badge"])
    .optional()
    .describe(
      "Inclusion path (default none). sayabout (Wall of Love URL, recommended) and badge need verificationUrl. For a paid (dofollow) listing use upgrade_listing."
    ),
  verificationUrl: z.string().url().optional().describe("Required for sayabout/badge proof"),
  externalId: z
    .string()
    .max(200)
    .optional()
    .describe("Your stable id for idempotent replays; derived from the URL when omitted"),
  source: z
    .string()
    .regex(/^[a-z0-9][a-z0-9:_-]{1,63}$/, "source must be a lowercase id like agent:mcp")
    .optional()
    .describe("Origin id, e.g. agent:mcp"),
  resubmit: z
    .boolean()
    .optional()
    .describe(
      "Set true to send a fresh copy after a previous submission for this URL was " +
        "rejected. Mints a new idempotency key so the reviewer gets a new row instead " +
        "of a replay of the rejected one."
    ),
})
  // Reject unknown fields instead of silently stripping them, matching the
  // OpenAPI's additionalProperties: false so a typo'd argument errors.
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.proof === "sayabout" || value.proof === "badge") &&
      !value.verificationUrl
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verificationUrl"],
        message: "verificationUrl is required when proof is sayabout or badge",
      });
    }
  });

export type SubmitToolArgs = z.infer<typeof SubmitToolSchema>;

export const SUBMIT_TOOL: Tool = {
  name: "submit_tool",
  description:
    "Submit a tool to the Altimateguide directory for editorial review " +
    "(POST /api/agent/submit). The listing is queued as pending and is never " +
    "published automatically — an editor reviews it. Categories are optional; " +
    "unknown/empty categories are recorded for the reviewer. Requires a token " +
    "(run complete_login, or set ALTIMATEGUIDE_AGENT_TOKEN).",
  inputSchema: inputSchemaFor(SubmitToolSchema),
  annotations: {
    title: "Submit a tool listing",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

/** Stable per-URL id so a retry (e.g. after a lost response) is idempotent. */
function derivedExternalId(url: string): string {
  return "url-" + createHash("sha256").update(url).digest("hex").slice(0, 32);
}

/**
 * A one-off id for an intentional resubmit after a rejection. Deliberately NOT
 * derived from the URL alone, so the site treats it as a new row instead of
 * replaying the rejected submission via the (source, external_id) index.
 */
function freshExternalId(url: string): string {
  return (
    "url-" +
    createHash("sha256")
      .update(`${url}#${Date.now()}#${Math.random()}`)
      .digest("hex")
      .slice(0, 32)
  );
}

export async function submitTool(args: SubmitToolArgs) {
  const externalId = args.resubmit
    ? freshExternalId(args.url)
    : args.externalId || derivedExternalId(args.url);
  const payload = {
    source: args.source || "agent:mcp",
    external_id: externalId,
    proof: args.proof || "none",
    verification_url: args.verificationUrl,
    agent: { name: "altimateguide-agent-mcp", version: VERSION },
    listing: {
      name: args.name,
      url: args.url,
      description: args.description,
      categories: args.categories,
      category_suggestions: args.categorySuggestions,
      features: args.features,
      pros: args.pros,
      cons: args.cons,
      pricing: args.pricing,
      free_plan: args.freePlan,
      free_trial: args.freeTrial,
    },
  };

  const data = await apiRequest<Record<string, unknown>>("/api/agent/submit", {
    method: "POST",
    body: payload,
    // Safe to replay: the (source, external_id) pair makes a retry idempotent.
    idempotent: true,
  });

  const result: Record<string, unknown> = { ...data };
  // A replay of a previously rejected submission is not a success — say so, and
  // point at the explicit resubmit path so the agent isn't stuck.
  if (!args.resubmit && result.status === "rejected") {
    result.resubmit_hint =
      "This URL was previously rejected. Call submit_tool again with resubmit: true " +
      "to send a revised listing for a fresh review.";
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}
