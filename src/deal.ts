/**
 * `submit_deal` — queue a time-boxed offer for editorial review.
 *
 * A deal is an offer attached to a listing: a lifetime deal (LTD), a sale, or a
 * launch price. It has its own review lane — free 7 calendar days, or priority
 * 2 business days when a payment reference is supplied — and appears on
 * https://altimateguide.com/deals once approved.
 *
 * Two things this tool deliberately cannot do:
 *   - it never changes the listing's outbound link tier (dofollow is earned via
 *     the listing paths: badge / SayAbout.Us wall / paid listing), and
 *   - it never publishes anything: the row is queued as pending.
 *
 * `endsAt` is optional. Omit it for an open-ended offer; the site then keeps the
 * deal live only while its last verification is under 30 days old.
 */
import { createHash } from "node:crypto";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { apiRequest } from "./api.js";
import { inputSchemaFor } from "./schema.js";
import { VERSION } from "./version.js";

export const SubmitDealSchema = z
  .object({
    name: z.string().min(1, "Product name is required").describe("Product name"),
    url: z
      .string()
      .url("A valid http(s) product URL is required")
      .describe("Canonical product URL (matched to a listing by domain)"),
    dealUrl: z
      .string()
      .url("A valid http(s) deal URL is required")
      .describe(
        "Page documenting the offer. Required — the editor verifies the price and " +
          "dates against it before the deal goes live."
      ),
    price: z.number().min(0).describe("Current deal price in USD"),
    kind: z
      .enum(["ltd", "sale", "launch"])
      .describe("ltd = lifetime deal, sale = discount, launch = launch offer"),
    billing: z
      .enum(["one-time", "month", "year"])
      .optional()
      .describe("How the offer is charged (default one-time). Not the product's normal pricing."),
    wasPrice: z
      .number()
      .min(0)
      .optional()
      .describe("Pre-deal price, shown struck through. Only use a price you verified."),
    endsAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "endsAt must be YYYY-MM-DD")
      .optional()
      .describe(
        "Last day the offer is valid (YYYY-MM-DD). Omit for an open-ended offer."
      ),
    tiers: z
      .array(
        z.object({
          name: z.string().min(1),
          codes: z.number().int().min(0).optional(),
        })
      )
      .optional()
      .describe("Code tiers, e.g. [{ name: 'Tier 1', codes: 2 }]"),
    description: z
      .string()
      .optional()
      .describe("Short 'what's included' line shown on the deals hub"),
    categories: z
      .array(z.string().min(1))
      .optional()
      .describe("Category slugs for an unlisted product (call list_categories)"),
    paymentRef: z
      .string()
      .max(200)
      .optional()
      .describe(
        "Payment reference from a paid listing. Presence puts the deal in the " +
          "priority lane (2 business days); omit for the free lane (7 days)."
      ),
    externalId: z
      .string()
      .max(200)
      .optional()
      .describe("Your stable id for idempotent replays (derived from the URLs when omitted)"),
    source: z
      .string()
      .regex(/^[a-z0-9][a-z0-9:_-]{1,63}$/, "source must be a lowercase id like agent:mcp")
      .optional()
      .describe("Origin id, e.g. agent:mcp"),
  })
  .strict();

export type SubmitDealArgs = z.infer<typeof SubmitDealSchema>;

export const SUBMIT_DEAL_TOOL: Tool = {
  name: "submit_deal",
  description:
    "Submit a time-boxed deal — a lifetime deal, a sale, or a launch offer — for " +
    "the product (POST /api/agent/deals). Use this when the product has a current " +
    "discount, an LTD, or a launch price that should appear on " +
    "https://altimateguide.com/deals. Provide the page that documents the offer " +
    "(`dealUrl`) — every deal is verified against it. Review is 7 calendar days " +
    "free, or 2 business days with a paid listing's `paymentRef`. `endsAt` is " +
    "optional: omit it for an open-ended offer. A deal NEVER changes the " +
    "listing's link tier — dofollow is earned through the listing paths " +
    "(badge / SayAbout.Us / paid listing). Requires a token (run complete_login, " +
    "or set ALTIMATEGUIDE_AGENT_TOKEN).",
  inputSchema: inputSchemaFor(SubmitDealSchema),
  annotations: {
    title: "Submit a deal",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

/** Stable per-offer id so a retry (e.g. after a lost response) is idempotent. */
function derivedExternalId(url: string, dealUrl: string): string {
  return (
    "deal-" +
    createHash("sha256").update(`${url}#${dealUrl}`).digest("hex").slice(0, 32)
  );
}

export async function submitDeal(args: SubmitDealArgs) {
  const externalId = args.externalId || derivedExternalId(args.url, args.dealUrl);
  const payload = {
    source: args.source || "agent:mcp",
    external_id: externalId,
    agent: { name: "altimateguide-agent-mcp", version: VERSION },
    toolName: args.name,
    toolUrl: args.url,
    dealUrl: args.dealUrl,
    kind: args.kind,
    billing: args.billing || "one-time",
    price: args.price,
    wasPrice: args.wasPrice,
    endsAt: args.endsAt,
    tiers: args.tiers,
    description: args.description,
    categories: args.categories,
    payment_ref: args.paymentRef,
  };

  const data = await apiRequest<Record<string, unknown>>("/api/agent/deals", {
    method: "POST",
    body: payload,
    // Safe to replay: (source, external_id) makes a retry idempotent.
    idempotent: true,
  });

  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}
