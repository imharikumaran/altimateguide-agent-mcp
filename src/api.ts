/**
 * Shared Altimateguide API client for the MCP tools.
 *
 * One place for the API base, bearer auth, request timeout, retry/back-off on
 * transient failures, and — importantly — mapping HTTP statuses onto JSON-RPC
 * error codes so an agent can tell "fix your arguments" (InvalidParams) apart
 * from "you're authenticated but this is a duplicate / rate limited" and from a
 * genuine server fault (InternalError).
 */
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { getToken } from "./credentials.js";

/** A plain Error carrying a numeric JSON-RPC `code` (the SDK preserves it). */
export function toolError(code: number, message: string): Error & { code: number } {
  const error = new Error(message) as Error & { code: number };
  error.code = code;
  return error;
}

export function apiBase(): string {
  return (process.env.ALTIMATEGUIDE_API_URL || "https://altimateguide.com").replace(/\/+$/, "");
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Send the account bearer token (default true). */
  auth?: boolean;
  /** Extra retries on transient failures (429/5xx/network). Default 2. */
  retries?: number;
  /**
   * Whether a transient failure may be retried. Defaults to true only for safe
   * methods (GET/HEAD): a retried POST can duplicate a non-idempotent write
   * (e.g. a second upgrade row / checkout session), so callers that are safe to
   * replay (submit_tool, which carries an external_id) must opt in explicitly.
   */
  idempotent?: boolean;
  timeoutMs?: number;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Make an API request and return the parsed JSON body. Throws an error with a
 * JSON-RPC `code` on failure (never returns a non-2xx body).
 */
export async function apiRequest<T = Record<string, unknown>>(
  path: string,
  opts: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, auth = true, retries = 2, timeoutMs = 15000 } = opts;
  const idempotent = opts.idempotent ?? (method === "GET" || method === "HEAD");

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (!token) {
      throw toolError(
        ErrorCode.InvalidRequest,
        "No API token configured. Run complete_login with an email + code, or set " +
          "ALTIMATEGUIDE_AGENT_TOKEN."
      );
    }
    headers.Authorization = `Bearer ${token}`;
  }

  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(`${apiBase()}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (idempotent && attempt < retries) {
        attempt += 1;
        await sleep(500 * attempt);
        continue;
      }
      throw toolError(
        ErrorCode.InternalError,
        `Could not reach the Altimateguide API at ${apiBase()}: ${message}`
      );
    }

    // Read as text first so a non-JSON error body (an HTML/proxy 500, say) keeps
    // its detail instead of collapsing to a bare "HTTP 500".
    const rawBody = await res.text().catch(() => "");
    let data: Record<string, unknown> = {};
    if (rawBody) {
      try {
        data = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        data = {};
      }
    }
    if (res.ok) return data as T;

    if (idempotent && RETRYABLE_STATUS.has(res.status) && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 500 * (attempt + 1);
      attempt += 1;
      await sleep(Math.min(waitMs, 10_000));
      continue;
    }

    throw mapStatusToError(res.status, data, rawBody);
  }
}

function mapStatusToError(
  status: number,
  data: Record<string, unknown>,
  rawBody = ""
): Error & { code: number } {
  const detail = String(
    data.error || data.message || rawBody.trim().slice(0, 300) || `HTTP ${status}`
  );
  switch (status) {
    case 400:
    case 404:
      return toolError(ErrorCode.InvalidParams, `Request failed (${status}): ${detail}`);
    case 401:
    case 403:
      return toolError(
        ErrorCode.InvalidRequest,
        `Authentication failed (${status}) — check/replace your token: ${detail}`
      );
    case 409:
      return toolError(
        ErrorCode.InvalidRequest,
        `Already listed or already awaiting review (${status}) — do not retry: ${detail}`
      );
    case 422:
      return toolError(
        ErrorCode.InvalidParams,
        `The editorial gate rejected the copy — rewrite it neutrally and retry: ${detail}`
      );
    case 429:
      return toolError(
        ErrorCode.InternalError,
        `Rate limited — back off and try again later: ${detail}`
      );
    default:
      return toolError(ErrorCode.InternalError, `Request failed (${status}): ${detail}`);
  }
}
