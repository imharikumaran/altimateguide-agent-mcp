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
  description: "Report whether an API token is configured locally and where the API points.",
  inputSchema: { type: "object", properties: {} },
  annotations: { title: "Account status", readOnlyHint: true, openWorldHint: false },
};

export function whoami(): { authenticated: boolean; tokenPreview?: string; apiBase: string } {
  const preview = tokenPreview();
  return { authenticated: Boolean(preview), tokenPreview: preview, apiBase: apiBase() };
}
