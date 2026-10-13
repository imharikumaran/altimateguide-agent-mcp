/**
 * Browserless onboarding: exchange an email OTP for an account API token.
 *
 * Two steps so an email-capable agent can drive it: start_login emails a code
 * (POST /api/auth/request-code), then complete_login exchanges that code for a
 * token (POST /api/agent/token) and stores it locally for later tools.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { apiRequest, apiBase, toolError } from "./api.js";
import { saveToken, tokenPreview } from "./credentials.js";
import { inputSchemaFor } from "./schema.js";

export const StartLoginSchema = z.object({
  email: z.string().email().describe("Email whose inbox can read the login code"),
});

export const START_LOGIN_TOOL: Tool = {
  name: "start_login",
  description:
    "Email a one-time login code to begin browserless onboarding " +
    "(POST /api/auth/request-code). Then read the code from the inbox and call complete_login.",
  inputSchema: inputSchemaFor(StartLoginSchema),
  annotations: { title: "Start login", readOnlyHint: false, openWorldHint: true },
};

export async function startLogin(email: string): Promise<string> {
  await apiRequest("/api/auth/request-code", {
    method: "POST",
    body: { email },
    auth: false,
  });
  return (
    `Login code sent to ${email}. Read the 6-digit code from that inbox, then call ` +
    `complete_login with the same email and the code.`
  );
}

export const CompleteLoginSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "The code is 6 digits").describe("6-digit code from the email"),
  name: z.string().max(60).optional().describe("Token label (e.g. claude-desktop)"),
});

export const COMPLETE_LOGIN_TOOL: Tool = {
  name: "complete_login",
  description:
    "Exchange an email login code for an account API token and store it locally " +
    "(POST /api/agent/token). The token is bound to that account; submissions are owned by it.",
  inputSchema: inputSchemaFor(CompleteLoginSchema),
  annotations: { title: "Complete login", readOnlyHint: false, openWorldHint: true },
};

export async function completeLogin(
  email: string,
  code: string,
  name?: string
): Promise<{ account?: { id: number; email: string }; tokenPreview: string }> {
  const data = await apiRequest<{ token?: string; account?: { id: number; email: string } }>(
    "/api/agent/token",
    { method: "POST", body: { email, code, name }, auth: false }
  );
  if (!data.token) {
    throw toolError(ErrorCode.InternalError, "The API did not return a token.");
  }
  saveToken(data.token);
  return { account: data.account, tokenPreview: tokenPreview() ?? "" };
}

export const WHOAMI_TOOL: Tool = {
  name: "whoami",
  description:
    "Confirm the configured token is live and report the account it belongs to " +
    "(GET /api/agent/whoami). Distinguishes a missing token from a revoked/expired one.",
  inputSchema: { type: "object", properties: {} },
  annotations: { title: "Account status", readOnlyHint: true, openWorldHint: true },
};

export interface WhoamiResult {
  authenticated: boolean;
  account?: { id: number; email: string };
  tokenPreview?: string;
  apiBase: string;
  error?: string;
}

/**
 * Verify the token against the API rather than trusting local presence: a
 * revoked or expired `atg_` token must report unauthenticated, not a false
 * "authenticated: true". A missing token is reported (not thrown) so the tool
 * stays a pure status check.
 */
export async function whoami(): Promise<WhoamiResult> {
  const result: WhoamiResult = {
    authenticated: false,
    tokenPreview: tokenPreview(),
    apiBase: apiBase(),
  };
  try {
    const data = await apiRequest<{ account?: { id: number; email: string } }>(
      "/api/agent/whoami"
    );
    result.authenticated = true;
    result.account = data.account;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

/* --------------------------- AgentID login ---------------------------- */

export const START_AGENTID_LOGIN_TOOL: Tool = {
  name: "start_agentid_login",
  description:
    "Begin an AgentID sign-in (POST /api/agent/agentid/start) so an agent can register " +
    "without an email inbox. Returns an authorizeUrl and a flowId — open the URL to " +
    "complete the sign-in, then call complete_agentid_login with the flowId.",
  inputSchema: { type: "object", properties: {} },
  annotations: { title: "Start AgentID login", readOnlyHint: false, openWorldHint: true },
};

export interface StartAgentIdLoginResult {
  flowId: string;
  authorizeUrl: string;
  expiresAt: string;
}

export async function startAgentIdLogin(): Promise<StartAgentIdLoginResult> {
  return apiRequest<StartAgentIdLoginResult>("/api/agent/agentid/start", {
    method: "POST",
    body: {},
    auth: false,
  });
}

export const CompleteAgentIdLoginSchema = z.object({
  flowId: z.string().min(1).describe("The flowId returned by start_agentid_login"),
});

export const COMPLETE_AGENTID_LOGIN_TOOL: Tool = {
  name: "complete_agentid_login",
  description:
    "Poll an AgentID sign-in (GET /api/agent/agentid/poll) and, once the browser leg is " +
    "done, store the resulting account API token locally. Returns status 'pending' until " +
    "the sign-in completes.",
  inputSchema: inputSchemaFor(CompleteAgentIdLoginSchema),
  annotations: { title: "Complete AgentID login", readOnlyHint: false, openWorldHint: true },
};

export async function completeAgentIdLogin(
  flowId: string
): Promise<Record<string, unknown>> {
  const data = await apiRequest<Record<string, unknown>>(
    `/api/agent/agentid/poll?flow=${encodeURIComponent(flowId)}`,
    { auth: false }
  );
  if (typeof data.token === "string") {
    saveToken(data.token);
    data.tokenPreview = tokenPreview() ?? "";
    delete data.token;
  }
  return data;
}
