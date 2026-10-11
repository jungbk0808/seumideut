import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthUser = { id: string; email: string | null };
export type AuthPhase = "loading" | "ready" | "opening" | "waiting" | "exchanging" | "signing-out" | "unconfigured";
export type AuthSnapshot = { phase: AuthPhase; user: AuthUser | null; error: string | null };
export type OAuthResult = { attemptId: string; code: string | null; error: string | null };
export type AuthPlatform = {
  native: boolean;
  createAttemptId: () => string;
  start: (attemptId: string) => Promise<string>;
  cancel: () => Promise<void>;
  clearVerifier: () => Promise<void>;
  open: (url: string) => Promise<void>;
  listen: (callback: (result: OAuthResult) => void) => Promise<() => void>;
  consumeBrowserResult: () => OAuthResult | null;
};

// No session tokens enter React state. No note storage is touched by this class.
export class AuthController {
  private snapshot: AuthSnapshot = { phase: "loading", user: null, error: null };
  private listeners = new Set<() => void>();
  private initialization: Promise<void> | null = null;
  private attemptId: string | null = null;
  private client: Pick<SupabaseClient, "auth"> | null;
  private platform: AuthPlatform;

  constructor(client: Pick<SupabaseClient, "auth"> | null, platform: AuthPlatform, setupError: string | null = null) {
    this.client = client;
    this.platform = platform;
    if (!client) this.snapshot = { phase: "unconfigured", user: null, error: setupError };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(change: Partial<AuthSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((listener) => listener());
  }

  initialize() {
    return this.initialization ??= this.restore();
  }

  private async restore() {
    if (!this.client) return;
    try {
      this.client.auth.onAuthStateChange((_event, session) => {
        this.update({ user: session ? { id: session.user.id, email: session.user.email ?? null } : null });
      });
      await this.platform.listen((result) => { void this.complete(result); });
      const result = this.platform.consumeBrowserResult();
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      this.update({ user: data.session ? { id: data.session.user.id, email: data.session.user.email ?? null } : null });
      if (result) {
        this.attemptId = result.attemptId;
        this.update({ phase: "waiting" });
        await this.complete(result);
      } else {
        this.update({ phase: "ready" });
      }
    } catch {
      this.update({ phase: "ready", error: "로그인 정보를 불러올 수 없어요. 네트워크와 로그인 저장소를 확인하고 앱을 다시 열어 주세요." });
    }
  }

  signIn = async () => {
    if (!this.client || this.snapshot.phase !== "ready" || this.snapshot.user) return;
    this.attemptId = this.platform.createAttemptId();
    const attemptId = this.attemptId;
    this.update({ phase: "opening", error: null });
    try {
      const redirectTo = await this.platform.start(attemptId);
      const { data, error } = await this.client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
      });
      if (error || !data.url) throw error ?? new Error("Missing authorization URL");
      this.update({ phase: "waiting" });
      await this.platform.open(data.url);
    } catch {
      this.attemptId = null;
      await this.cleanup();
      this.update({ phase: "ready", error: "로그인을 시작할 수 없어요. 연결 정보, 네트워크, Google 로그인 설정과 1421 포트 사용 여부를 확인하세요." });
    }
  };

  private async cleanup() {
    // Retain the original failure message if cleanup also fails.
    await Promise.allSettled([this.platform.cancel(), this.platform.clearVerifier()]);
  }

  cancel = async () => {
    if (this.snapshot.phase !== "waiting") return;
    this.attemptId = null; // Ignore responses already queued by a cancelled attempt.
    this.update({ phase: "loading", error: null });
    await this.cleanup();
    this.update({ phase: "ready" });
  };

  private async complete(result: OAuthResult) {
    if (!this.client || this.snapshot.phase !== "waiting" || result.attemptId !== this.attemptId) return;
    this.attemptId = null; // At most one exchange per attempt.
    this.update({ phase: "exchanging" });
    try {
      if (result.error || !result.code) throw new Error("OAuth denied or expired");
      const { data, error } = await this.client.auth.exchangeCodeForSession(result.code);
      if (error || !data.session) throw error ?? new Error("Missing session");
      this.update({ user: { id: data.session.user.id, email: data.session.user.email ?? null }, error: null });
    } catch {
      this.update({ error: result.error === "timeout"
        ? "로그인 대기 시간이 지났어요. Google 로그인을 다시 눌러 주세요."
        : "로그인을 완료하지 못했어요. 다시 시도하고 로그인 복귀 주소 설정을 확인하세요." });
    } finally {
      await this.cleanup();
      this.update({ phase: "ready" });
    }
  }

  signOut = async () => {
    if (!this.client || this.snapshot.phase !== "ready" || !this.snapshot.user) return;
    this.update({ phase: "signing-out", error: null });
    try {
      const { error } = await this.client.auth.signOut({ scope: "local" });
      if (error) throw error;
      this.update({ user: null });
    } catch {
      this.update({ error: "로그아웃하지 못했어요. 네트워크 연결을 확인하고 다시 시도하세요." });
    } finally {
      this.update({ phase: "ready" });
    }
  };
}
