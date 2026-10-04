import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpgradeListingSchema, getSubmission, upgradeListing } from "../src/listing";
import { SubmitToolSchema, submitTool } from "../src/submit";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let originalToken: string | undefined;
let originalBase: string | undefined;

beforeEach(() => {
  originalToken = process.env.ALTIMATEGUIDE_AGENT_TOKEN;
  originalBase = process.env.ALTIMATEGUIDE_API_URL;
  process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
  delete process.env.ALTIMATEGUIDE_API_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalToken === undefined) delete process.env.ALTIMATEGUIDE_AGENT_TOKEN;
  else process.env.ALTIMATEGUIDE_AGENT_TOKEN = originalToken;
  if (originalBase === undefined) delete process.env.ALTIMATEGUIDE_API_URL;
  else process.env.ALTIMATEGUIDE_API_URL = originalBase;
});

describe("retry policy", () => {
  it("does not retry a non-idempotent POST (upgrade_listing)", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ error: "boom" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(upgradeListing({ path: "paid", submissionId: 1 })).rejects.toMatchObject({
      code: ErrorCode.InternalError,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a network failure on a POST without an idempotent opt-in", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockRejectedValue(new Error("connection refused"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(upgradeListing({ path: "paid", submissionId: 1 })).rejects.toMatchObject({
      code: ErrorCode.InternalError,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a GET (get_submission) on a transient failure", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 503))
      .mockResolvedValueOnce(jsonResponse({ id: 7, status: "pending" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSubmission({ id: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.structuredContent).toEqual({ id: 7, status: "pending" });
  });

  it("retries an idempotent POST (submit_tool) on a transient failure", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500))
      .mockResolvedValueOnce(jsonResponse({ submission_id: 1, status: "pending" }, 202));
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitTool(
      SubmitToolSchema.parse({ name: "Example", url: "https://example.com" })
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.structuredContent).toMatchObject({ status: "pending" });
  });

  it("preserves a non-JSON error body in the message", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(upgradeListing({ path: "paid", submissionId: 1 })).rejects.toMatchObject({
      message: expect.stringContaining("Bad Gateway"),
    });
  });
});

describe("UpgradeListingSchema", () => {
  it("requires exactly one of submissionId or slug", () => {
    expect(UpgradeListingSchema.safeParse({ path: "paid" }).success).toBe(false);
    expect(
      UpgradeListingSchema.safeParse({ path: "paid", submissionId: 1, slug: "x" }).success
    ).toBe(false);
    expect(UpgradeListingSchema.safeParse({ path: "paid", submissionId: 1 }).success).toBe(
      true
    );
    expect(UpgradeListingSchema.safeParse({ path: "paid", slug: "x" }).success).toBe(true);
  });

  it("requires verificationUrl for sayabout/badge", () => {
    expect(UpgradeListingSchema.safeParse({ path: "sayabout", slug: "x" }).success).toBe(
      false
    );
    expect(
      UpgradeListingSchema.safeParse({
        path: "sayabout",
        slug: "x",
        verificationUrl: "https://example.com/wall",
      }).success
    ).toBe(true);
  });
});
