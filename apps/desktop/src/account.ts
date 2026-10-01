export type AuthProviderId = "google";

// MVP supports Google only. Add an entry here to offer another social login.
export const AUTH_PROVIDERS: { id: AuthProviderId; label: string }[] = [
  { id: "google", label: "Google" },
];

// Only the minimum is kept: which provider signed in and the email it returned.
export type Account = {
  provider: AuthProviderId;
  email: string;
};

// Cloud sync is not built yet, so manual sync stays usable without an account.
// Flip this once sign-in is wired to a real backend.
export const SYNC_REQUIRES_ACCOUNT = false;

const ACCOUNT_KEY = "memo-app:account";

export class AuthNotConfiguredError extends Error {
  constructor() {
    super("Social sign-in is not connected yet.");
    this.name = "AuthNotConfiguredError";
  }
}

export function getProviderLabel(providerId: AuthProviderId) {
  return AUTH_PROVIDERS.find((provider) => provider.id === providerId)?.label ?? "";
}

export function loadAccount(): Account | null {
  try {
    const rawAccount = window.localStorage.getItem(ACCOUNT_KEY);
    if (!rawAccount) return null;

    const value: unknown = JSON.parse(rawAccount);
    if (typeof value !== "object" || value === null) return null;

    const { provider, email } = value as Record<string, unknown>;
    const isKnownProvider = AUTH_PROVIDERS.some((entry) => entry.id === provider);

    return isKnownProvider && typeof email === "string" && email
      ? { provider: provider as AuthProviderId, email }
      : null;
  } catch {
    return null;
  }
}

export function saveAccount(account: Account) {
  window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

export function signOut() {
  window.localStorage.removeItem(ACCOUNT_KEY);
}

// The OAuth flow (browser redirect, token exchange) needs a backend and client
// credentials that do not exist yet. Resolve with an Account once it does.
export async function signIn(_providerId: AuthProviderId): Promise<Account> {
  throw new AuthNotConfiguredError();
}
