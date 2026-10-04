import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiBase } from "../src/api";
import { SUBMIT_TOOL, SubmitToolSchema, submitTool } from "../src/submit";

const baseArgs = {
  name: "Example Tool",
  url: "https://example.com/tool",
  categories: ["productivity"],
};

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
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalToken === undefined) delete process.env.ALTIMATEGUIDE_AGENT_TOKEN;
  else process.env.ALTIMATEGUIDE_AGENT_TOKEN = originalToken;
  if (originalBase === undefined) delete process.env.ALTIMATEGUIDE_API_URL;
  else process.env.ALTIMATEGUIDE_API_URL = originalBase;
});

describe("apiBase", () => {
  it("defaults to the production API", () => {
    delete process.env.ALTIMATEGUIDE_API_URL;
    expect(apiBase()).toBe("https://altimateguide.com");
  });

  it("trims trailing slashes from an override", () => {
    process.env.ALTIMATEGUIDE_API_URL = "https://staging.example.com///";
    expect(apiBase()).toBe("https://staging.example.com");
  });
});

describe("submitTool", () => {
  it("posts a snake_case payload with a bearer token", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ submission_id: "s1", status: "pending" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitTool(
      SubmitToolSchema.parse({
        ...baseArgs,
        description: "A perfectly neutral description of the tool.",
        features: [{ label: "Fast" }],
        proof: "sayabout",
        verificationUrl: "https://example.com/review",
        externalId: "ext-1",
      })
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://altimateguide.com/api/agent/submit");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer atg_test");

    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      source: "agent:mcp",
      external_id: "ext-1",
      proof: "sayabout",
      verification_url: "https://example.com/review",
      agent: { name: "altimateguide-agent-mcp", version: expect.any(String) },
      listing: {
        name: "Example Tool",
        url: "https://example.com/tool",
        description: "A perfectly neutral description of the tool.",
        categories: ["productivity"],
        features: [{ label: "Fast" }],
      },
    });
    expect(body).not.toHaveProperty("externalId");

    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({
      submission_id: "s1",
      status: "pending",
    });
  });

  it("passes category suggestions through inside the listing", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "pending" }));
    vi.stubGlobal("fetch", fetchMock);

    await submitTool(
      SubmitToolSchema.parse({ ...baseArgs, categorySuggestions: ["ai writing assistant"] })
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.listing.category_suggestions).toEqual(["ai writing assistant"]);
  });

  it("derives an idempotent external id from the URL when none is given", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "pending" }));
    vi.stubGlobal("fetch", fetchMock);

    await submitTool(SubmitToolSchema.parse(baseArgs));

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.proof).toBe("none");
    expect(String(body.external_id)).toMatch(/^url-[0-9a-f]{32}$/);
  });

  it("fails fast, without calling the API, when the token is missing", async () => {
    delete process.env.ALTIMATEGUIDE_AGENT_TOKEN;
    process.env.ALTIMATEGUIDE_CONFIG_DIR = "/nonexistent-altimateguide-test";
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitTool(SubmitToolSchema.parse(baseArgs))).rejects.toMatchObject({
      code: ErrorCode.InvalidRequest,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a 409 duplicate to an invalid request error", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "duplicate submission" }, 409));
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitTool(SubmitToolSchema.parse(baseArgs))).rejects.toMatchObject({
      code: ErrorCode.InvalidRequest,
      message: expect.stringContaining("409"),
    });
  });

  it("maps a 422 editorial rejection to an invalid params error", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "promotional language" }, 422));
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitTool(SubmitToolSchema.parse(baseArgs))).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
  });

  it("maps network failures to internal errors", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockRejectedValue(new Error("connection refused"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitTool(SubmitToolSchema.parse(baseArgs))).rejects.toMatchObject({
      code: ErrorCode.InternalError,
      message: expect.stringContaining("connection refused"),
    });
  });
});

describe("submitTool resubmit", () => {
  it("mints a fresh external id when resubmit is true", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "pending" }, 202));
    vi.stubGlobal("fetch", fetchMock);

    await submitTool(SubmitToolSchema.parse({ ...baseArgs, resubmit: true }));

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(String(body.external_id)).toMatch(/^url-[0-9a-f]{32}$/);
    expect(body).not.toHaveProperty("resubmit");
  });

  it("uses a different external id than a plain submit for the same URL", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ status: "pending" }, 202));
    vi.stubGlobal("fetch", fetchMock);

    await submitTool(SubmitToolSchema.parse(baseArgs));
    await submitTool(SubmitToolSchema.parse({ ...baseArgs, resubmit: true }));

    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(second.external_id).not.toBe(first.external_id);
  });

  it("flags a rejected replay with a resubmit hint", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ submission_id: 5, status: "rejected" }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitTool(SubmitToolSchema.parse(baseArgs));

    expect(result.structuredContent.status).toBe("rejected");
    expect(String(result.structuredContent.resubmit_hint)).toMatch(/resubmit: true/);
  });

  it("does not add a resubmit hint for a fresh pending submission", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ submission_id: 6, status: "pending" }, 202));
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitTool(SubmitToolSchema.parse(baseArgs));

    expect(result.structuredContent).not.toHaveProperty("resubmit_hint");
  });
});

describe("SubmitToolSchema", () => {
  it("allows an empty or missing category list", () => {
    expect(SubmitToolSchema.safeParse({ ...baseArgs, categories: [] }).success).toBe(true);
    expect(SubmitToolSchema.safeParse({ name: "X", url: "https://x.com" }).success).toBe(true);
  });

  it("rejects a description shorter than 20 characters", () => {
    expect(SubmitToolSchema.safeParse({ ...baseArgs, description: "too short" }).success).toBe(
      false
    );
  });

  it("rejects a non-URL", () => {
    expect(SubmitToolSchema.safeParse({ ...baseArgs, url: "not-a-url" }).success).toBe(false);
  });

  it("rejects a malformed source id", () => {
    expect(SubmitToolSchema.safeParse({ ...baseArgs, source: "Agent MCP" }).success).toBe(false);
  });

  it("does not accept a self-declared paid proof", () => {
    expect(SubmitToolSchema.safeParse({ ...baseArgs, proof: "paid" }).success).toBe(false);
  });
});

interface JsonSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, { minLength?: number; enum?: string[] }>;
}

describe("SUBMIT_TOOL input schema", () => {
  it("is derived from the Zod schema", () => {
    const schema = SUBMIT_TOOL.inputSchema as unknown as JsonSchema;
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(expect.arrayContaining(["name", "url"]));
    expect(schema.required).not.toContain("categories");
    expect(schema.properties?.description?.minLength).toBe(20);
    expect(schema.properties?.proof?.enum).toEqual(["none", "sayabout", "badge"]);
    expect(schema).not.toHaveProperty("$schema");
  });
});

describe("SubmitToolSchema strictness", () => {
  it("rejects unknown arguments instead of silently dropping them", () => {
    expect(SubmitToolSchema.safeParse({ ...baseArgs, bogusArgument: true }).success).toBe(
      false
    );
  });

  it("requires verificationUrl for sayabout/badge proof", () => {
    expect(SubmitToolSchema.safeParse({ ...baseArgs, proof: "sayabout" }).success).toBe(
      false
    );
    expect(
      SubmitToolSchema.safeParse({
        ...baseArgs,
        proof: "sayabout",
        verificationUrl: "https://example.com/wall-of-love",
      }).success
    ).toBe(true);
  });
});
