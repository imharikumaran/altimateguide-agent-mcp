/**
 * Listing support tools: duplicate preflight, status polling, and the
 * sayabout/badge/paid upgrade path (paid returns a Dodo checkout URL).
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { apiRequest } from "./api.js";
import { inputSchemaFor } from "./schema.js";

function structured(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

/* ------------------------------ check_duplicate ------------------------------ */

export const CheckDuplicateSchema = z.object({
  name: z.string().optional().describe("Tool name to check"),
  url: z.string().url().optional().describe("Tool URL to check"),
});

export const CHECK_DUPLICATE_TOOL: Tool = {
  name: "check_duplicate",
  description:
    "Check whether a tool is already listed or already awaiting review " +
    "(GET /api/agent/check) before submitting, so you don't burn a rate-limited write on a 409.",
  inputSchema: inputSchemaFor(CheckDuplicateSchema),
  annotations: { title: "Check for a duplicate", readOnlyHint: true, openWorldHint: true },
};

export async function checkDuplicate(args: z.infer<typeof CheckDuplicateSchema>) {
  const params = new URLSearchParams();
  if (args.name) params.set("name", args.name);
  if (args.url) params.set("url", args.url);
  const data = await apiRequest<Record<string, unknown>>(
    `/api/agent/check?${params.toString()}`
  );
  return structured(data);
}

/* ------------------------------ get_submission ------------------------------- */

export const GetSubmissionSchema = z.object({
  id: z.number().int().positive().describe("The submission_id returned by submit_tool"),
});

export const GET_SUBMISSION_TOOL: Tool = {
  name: "get_submission",
  description:
    "Poll a submission's status (pending/approved/rejected), link tier, pending " +
    "review_eta, and whether a paid checkout has been verified " +
    "(GET /api/agent/submissions/{id}).",
  inputSchema: inputSchemaFor(GetSubmissionSchema),
  annotations: { title: "Get submission status", readOnlyHint: true, openWorldHint: true },
};

export async function getSubmission(args: z.infer<typeof GetSubmissionSchema>) {
  const data = await apiRequest<Record<string, unknown>>(
    `/api/agent/submissions/${args.id}`
  );
  return structured(data);
}

/* ------------------------------ upgrade_listing ------------------------------ */

/** Keep in sync with altimateguide.com/src/data/paid-listing.ts. */
const PAID_PRICE = "$14.99 one-time";

export const UpgradeListingSchema = z.object({
  path: z
    .enum(["paid", "sayabout", "badge"])
    .describe(
      "Inclusion path. 'paid' is the fastest dofollow route — " +
        `${PAID_PRICE}, reviewed within 2 business days, nothing to install or ` +
        "verify, and it returns a Dodo checkout URL. 'sayabout' is free " +
        "(live Wall of Love URL, reviewed within 2 business days); 'badge' is " +
        "free (reviewed in 5-7 business days)."
    ),
  submissionId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Target a pending submission you own"),
  slug: z
    .string()
    .optional()
    .describe("Target a published tool you own (opens/reuses an upgrade request)"),
  verificationUrl: z
    .string()
    .url()
    .optional()
    .describe("Required for sayabout (Wall of Love URL) / badge"),
}).superRefine((value, ctx) => {
  const targets = [value.submissionId, value.slug].filter(
    (v) => v !== undefined && v !== ""
  );
  if (targets.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["submissionId"],
      message: "Provide exactly one of submissionId or slug",
    });
  }
  if (
    (value.path === "sayabout" || value.path === "badge") &&
    !value.verificationUrl
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["verificationUrl"],
      message: "verificationUrl is required for sayabout or badge",
    });
  }
});

export const UPGRADE_LISTING_TOOL: Tool = {
  name: "upgrade_listing",
  description:
    "Choose how a listing you own earns a dofollow link (POST /api/agent/listing). " +
    `Paid is the fastest route (${PAID_PRICE}, reviewed within 2 business days, no ` +
    "badge or wall to install) and returns a Dodo checkout URL whose metadata carries " +
    "the submission id; the payment is verified server-side by the Dodo webhook. Free " +
    "alternatives: sayabout (live Wall of Love URL) and badge, both reviewed after " +
    "verification. Nothing publishes or self-grants dofollow here.",
  inputSchema: inputSchemaFor(UpgradeListingSchema),
  annotations: {
    title: "Upgrade a listing",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

export async function upgradeListing(args: z.infer<typeof UpgradeListingSchema>) {
  const data = await apiRequest<Record<string, unknown>>("/api/agent/listing", {
    method: "POST",
    body: args,
  });
  return structured(data);
}
