import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUBMIT_DEAL_TOOL, SubmitDealSchema, submitDeal } from "../src/deal";

const baseArgs = {
  name: "Example Tool",
  url: "https://example.com/tool",
  dealUrl: "https://example.com/black-friday",
  price: 49,
  kind: "ltd" as const,
};

function jsonResponse(body: unknown, status = 202): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let originalToken: string | undefined;

beforeEach(() => {
  originalToken = process.env.ALTIMATEGUIDE_AGENT_TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalToken === undefined) delete process.env.ALTIMATEGUIDE_AGENT_TOKEN;
  else process.env.ALTIMATEGUIDE_AGENT_TOKEN = originalToken;
});

describe("SUBMIT_DEAL_TOOL", () => {
  it("advertises the deal endpoint and required fields", () => {
    expect(SUBMIT_DEAL_TOOL.name).toBe("submit_deal");
    expect(SUBMIT_DEAL_TOOL.description).toContain("/api/agent/deals");
    expect(SUBMIT_DEAL_TOOL.inputSchema.required).toEqual(
      expect.arrayContaining(["name", "url", "dealUrl", "price", "kind"])
    );
  });

  it("does not require endsAt (open-ended offers are valid)", () => {
    expect(SUBMIT_DEAL_TOOL.inputSchema.required ?? []).not.toContain("endsAt");
  });
});

describe("SubmitDealSchema", () => {
  it("rejects unknown fields instead of silently dropping them", () => {
    expect(() => SubmitDealSchema.parse({ ...baseArgs, typo: true })).toThrow();
  });

  it("rejects a malformed end date", () => {
    expect(() => SubmitDealSchema.parse({ ...baseArgs, endsAt: "Dec 1" })).toThrow();
  });

  it("accepts an offer with no end date", () => {
    const parsed = SubmitDealSchema.parse(baseArgs);
    expect(parsed.endsAt).toBeUndefined();
  });
});

describe("submitDeal", () => {
  it("posts the flat deal payload and defaults billing to one-time", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ submission_id: 7, status: "pending", kind: "deal" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitDeal(
      SubmitDealSchema.parse({
        ...baseArgs,
        wasPrice: 199,
        tiers: [{ name: "Tier 1", codes: 2 }],
        description: "Lifetime access to every feature.",
          paymentRef: "ref-123",
        externalId: "deal-1",
      })
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://altimateguide.com/api/agent/deals");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer atg_test");

    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      source: "agent:mcp",
      external_id: "deal-1",
      toolName: "Example Tool",
      toolUrl: "https://example.com/tool",
      dealUrl: "https://example.com/black-friday",
      kind: "ltd",
      billing: "one-time",
      price: 49,
      wasPrice: 199,
      payment_ref: "ref-123",
    });
    expect(body.endsAt).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ kind: "deal" });
  });

  it("derives a stable external id from the product + deal URLs", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ submission_id: 1, status: "pending" }));
    vi.stubGlobal("fetch", fetchMock);

    const args = SubmitDealSchema.parse(baseArgs);
    await submitDeal(args);
    await submitDeal(args);

    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(first.external_id).toBe(second.external_id);
    expect(first.external_id).toMatch(/^deal-[0-9a-f]{32}$/);
  });
});
