import type { OAuthResult } from "./authController";

// Parse errors from either query or fragment, then scrub all authentication data.
export function consumeBrowserOAuth(urlString: string, pendingRaw: string | null, now: number): {
  result: OAuthResult | null;
  cleanUrl: string;
} {
  const url = new URL(urlString);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const code = url.searchParams.get("code");
  const providerError = url.searchParams.get("error") ?? url.searchParams.get("error_code") ?? fragment.get("error") ?? fragment.get("error_code");
  const hasResult = url.searchParams.has("code") || providerError !== null;
  let pending: { attemptId?: unknown; startedAt?: unknown } = {};
  try {
    const value: unknown = JSON.parse(pendingRaw ?? "{}");
    if (typeof value === "object" && value !== null) pending = value;
  } catch { /* malformed pending request cannot authorize a code exchange */ }
  const attemptId = url.searchParams.get("authAttempt");
  const age = typeof pending.startedAt === "number" ? now - pending.startedAt : Infinity;
  const valid = attemptId !== null && attemptId === pending.attemptId && age >= 0 && age < 300_000 && url.searchParams.getAll("code").length <= 1;
  const result: OAuthResult | null = hasResult ? {
    attemptId: attemptId ?? "invalid",
    code: valid ? code : null,
    error: valid ? providerError : "timeout",
  } : null;
  const authKeys = ["code", "error", "error_code", "error_description", "authAttempt", "access_token", "refresh_token", "provider_token", "provider_refresh_token", "expires_in", "expires_at", "token_type", "type"];
  for (const key of authKeys) url.searchParams.delete(key);
  if (authKeys.some((key) => fragment.has(key))) url.hash = "";
  return { result, cleanUrl: url.href };
}
