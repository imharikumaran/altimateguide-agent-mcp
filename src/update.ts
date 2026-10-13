/**
 * `update_listing` — edit the facts of a listing you own.
 *
 * Mirrors the website owner edit (PATCH /api/agent/listing/{slug}): same writable
 * field set, immediate publish, neutral-copy gate. Slug, outbound link tier and
 * paid status are admin-managed and can't be set here. Only the fields you pass
 * are changed.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { apiRequest } from "./api.js";
import { inputSchemaFor } from "./schema.js";

export const UpdateListingSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .describe("Slug of a listing you own (from submit_tool / get_submission)"),
    website: z.string().url().optional().describe("Canonical http(s) URL of the tool"),
    description: z
      .string()
      .min(20)
      .optional()
      .describe("Neutral listing copy (min 20 chars; ranking language is rejected)"),
    valueProposition: z.string().max(500).optional(),
    features: z
      .array(
        z.object({
          label: z.string().min(1).max(80),
          description: z.string().max(300).optional(),
        })
      )
      .optional()
      .describe("Structured feature list — replaces the existing one"),
    pros: z.array(z.string()).optional(),
    cons: z.array(z.string()).optional(),
    pricing: z
      .object({
        amount: z.number().positive(),
        currency: z.literal("USD"),
        period: z.enum(["month", "year", "one-time"]),
      })
      .nullable()
      .optional()
      .describe("Starting price (USD); pass null to clear it"),
    freePlan: z.boolean().optional(),
    freeTrial: z.boolean().optional(),
    categories: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe("Category slugs — call list_categories; replaces the existing set"),
  })
  .strict();

export type UpdateListingArgs = z.infer<typeof UpdateListingSchema>;

export const UPDATE_LISTING_TOOL: Tool = {
  name: "update_listing",
  description:
    "Edit the details of a listing you own (PATCH /api/agent/listing/{slug}). Only the " +
    "fields you pass are changed. Slug, outbound link tier and paid status are admin-managed. " +
    "Copy must be neutral — ranking language (best, top, leading, …) is rejected with 422.",
  inputSchema: inputSchemaFor(UpdateListingSchema),
  annotations: {
    title: "Update a listing",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export async function updateListing(args: UpdateListingArgs) {
  const { slug, description, pricing, ...rest } = args;
  const body: Record<string, unknown> = { ...rest };
  // The API's field names differ where the MCP vocabulary is friendlier.
  if (description !== undefined) body.definition = description;
  if (pricing !== undefined) body.startingPrice = pricing;

  const data = await apiRequest<Record<string, unknown>>(
    `/api/agent/listing/${encodeURIComponent(slug)}`,
    { method: "PATCH", body, idempotent: true }
  );
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}
