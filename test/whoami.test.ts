import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { whoami } from "../src/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let originalToken: string | undefined;
let originalBase: string | undefined;
let originalConfigDir: string | undefined;

beforeEach(() => {
  originalToken = process.env.ALTIMATEGUIDE_AGENT_TOKEN;
  originalBase = process.env.ALTIMATEGUIDE_API_URL;
  originalConfigDir = process.env.ALTIMATEGUIDE_CONFIG_DIR;
  process.env.ALTIMATEGUIDE_CONFIG_DIR = "/nonexistent-altimateguide-test";
  delete process.env.ALTIMATEGUIDE_API_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of [
    ["ALTIMATEGUIDE_AGENT_TOKEN", originalToken],
    ["ALTIMATEGUIDE_API_URL", originalBase],
    ["ALTIMATEGUIDE_CONFIG_DIR", originalConfigDir],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("whoami", () => {
  it("verifies the token against /api/agent/whoami and echoes the account", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_live_token";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ account: { id: 42, email: "owner@example.com" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await whoami();

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://altimateguide.com/api/agent/whoami"
    );
    expect(result.authenticated).toBe(true);
    expect(result.account).toEqual({ id: 42, email: "owner@example.com" });
    expect(result.apiBase).toBe("https://altimateguide.com");
  });

  it("reports unauthenticated for a revoked/expired token (401)", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_revoked";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "nope" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    const result = await whoami();

    expect(result.authenticated).toBe(false);
    expect(result.account).toBeUndefined();
    expect(result.error).toMatch(/Authentication failed/);
  });

  it("reports unauthenticated without calling the API when no token is configured", async () => {
    delete process.env.ALTIMATEGUIDE_AGENT_TOKEN;
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const result = await whoami();

    expect(result.authenticated).toBe(false);
    expect(result.tokenPreview).toBeUndefined();
    expect(result.error).toMatch(/No API token configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
