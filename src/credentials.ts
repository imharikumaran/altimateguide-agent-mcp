/**
 * Local token storage.
 *
 * `complete_login` exchanges an email OTP for an account API token and persists
 * it here (0600) so onboarding survives restarts. An
 * `ALTIMATEGUIDE_AGENT_TOKEN` environment variable always takes precedence, so
 * CI/CI-style setups can inject a token without touching the filesystem.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function credentialsPath(): string {
  const dir =
    process.env.ALTIMATEGUIDE_CONFIG_DIR || join(homedir(), ".config", "altimateguide");
  return join(dir, "credentials.json");
}

interface Credentials {
  token?: string;
}

function readCredentials(): Credentials {
  try {
    const file = credentialsPath();
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf8")) as Credentials;
  } catch {
    return {};
  }
}

/** The active token: env var first, then the stored credential. */
export function getToken(): string | undefined {
  return process.env.ALTIMATEGUIDE_AGENT_TOKEN || readCredentials().token;
}

/** Persist a token (0600) so it is reused on subsequent runs. */
export function saveToken(token: string): void {
  const file = credentialsPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ token }, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* best effort (some filesystems ignore mode) */
  }
}

/** Forget the stored token. */
export function clearToken(): void {
  try {
    rmSync(credentialsPath(), { force: true });
  } catch {
    /* ignore */
  }
}

/** A non-secret fingerprint of the active token, for display. */
export function tokenPreview(): string | undefined {
  const token = getToken();
  if (!token) return undefined;
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}
