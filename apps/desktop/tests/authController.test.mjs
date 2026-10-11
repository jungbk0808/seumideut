import assert from "node:assert/strict";
import test from "node:test";
import { AuthController } from "../src/cloud/authController.ts";

const session = { user: { id: "user-one", email: "owner@example.com" }, access_token: "never-in-react-state", refresh_token: "never-in-react-state" };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(overrides = {}) {
  const calls = { starts: 0, exchanges: [], cancels: 0, clears: 0, opened: [], signOut: [] };
  let callback;
  let authChanged;
  const client = { auth: {
    onAuthStateChange: (fn) => { authChanged = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    getSession: async () => ({ data: { session: overrides.session ?? null }, error: null }),
    signInWithOAuth: async (options) => { calls.options = options; return { data: { url: "https://project.supabase.co/auth/v1/authorize" }, error: null }; },
    exchangeCodeForSession: async (code) => {
      calls.exchanges.push(code);
      if (overrides.exchangeFails) return { data: { session: null }, error: new Error("secret-error-body") };
      authChanged("SIGNED_IN", session);
      return { data: { session }, error: null };
    },
    signOut: async (options) => {
      calls.signOut.push(options);
      if (overrides.signOutFails) return { error: new Error("network") };
      authChanged("SIGNED_OUT", null);
      return { error: null };
    },
  } };
  const platform = {
    native: true,
    createAttemptId: () => "attempt-one",
    start: async () => { calls.starts++; return "http://127.0.0.1:1421/auth/callback/attempt-one"; },
    open: async (url) => { if (overrides.openFails) throw new Error("browser"); calls.opened.push(url); },
    cancel: async () => { calls.cancels++; },
    clearVerifier: async () => { calls.clears++; },
    listen: async (fn) => { callback = fn; return () => {}; },
    consumeBrowserResult: () => overrides.browserResult ?? null,
  };
  const controller = new AuthController(client, platform);
  return { controller, calls, send: (result) => callback(result), authChanged: (...args) => authChanged(...args), platform };
}

test("missing config is a usable local-only state", async () => {
  const { platform } = setup();
  const controller = new AuthController(null, platform);
  await controller.initialize();
  await controller.signIn();
  assert.deepEqual(controller.getSnapshot(), { phase: "unconfigured", user: null, error: null });
});

test("restores persisted login without placing tokens in UI state", async () => {
  const { controller } = setup({ session });
  await Promise.all([controller.initialize(), controller.initialize()]);
  assert.deepEqual(controller.getSnapshot(), { phase: "ready", user: { id: "user-one", email: "owner@example.com" }, error: null });
  assert.ok(!JSON.stringify(controller.getSnapshot()).includes("never-in-react-state"));
});

test("one OAuth request opens the external browser with Google and PKCE redirect", async () => {
  const { controller, calls } = setup();
  await controller.initialize();
  await Promise.all([controller.signIn(), controller.signIn()]);
  assert.equal(calls.starts, 1);
  assert.equal(calls.opened.length, 1);
  assert.equal(calls.options.provider, "google");
  assert.equal(calls.options.options.skipBrowserRedirect, true);
  assert.equal(calls.options.options.redirectTo, "http://127.0.0.1:1421/auth/callback/attempt-one");
  assert.equal(controller.getSnapshot().phase, "waiting");
});

test("ignores another request and exchanges a matching response exactly once", async () => {
  const { controller, calls, send } = setup();
  await controller.initialize();
  await controller.signIn();
  send({ attemptId: "wrong", code: "bad", error: null });
  send({ attemptId: "attempt-one", code: "good", error: null });
  send({ attemptId: "attempt-one", code: "duplicate", error: null });
  await tick();
  assert.deepEqual(calls.exchanges, ["good"]);
  assert.equal(controller.getSnapshot().user.id, "user-one");
  assert.equal(controller.getSnapshot().phase, "ready");
  assert.equal(calls.clears, 1);
});

test("cancel closes the receiver, clears PKCE and ignores late responses", async () => {
  const { controller, calls, send } = setup();
  await controller.initialize();
  await controller.signIn();
  await controller.cancel();
  send({ attemptId: "attempt-one", code: "late", error: null });
  await tick();
  assert.deepEqual(calls.exchanges, []);
  assert.equal(calls.cancels, 1);
  assert.equal(calls.clears, 1);
  assert.equal(controller.getSnapshot().phase, "ready");
});

for (const error of ["denied", "timeout"]) {
  test(`OAuth ${error} leaves a retryable error`, async () => {
    const { controller, calls, send } = setup();
    await controller.initialize();
    await controller.signIn();
    send({ attemptId: "attempt-one", code: null, error });
    await tick();
    assert.equal(controller.getSnapshot().phase, "ready");
    assert.ok(controller.getSnapshot().error);
    assert.deepEqual(calls.exchanges, []);
    await controller.signIn();
    assert.equal(calls.starts, 2);
  });
}

test("failed code exchange hides raw responses and can be retried", async () => {
  const { controller, send } = setup({ exchangeFails: true });
  await controller.initialize();
  await controller.signIn();
  send({ attemptId: "attempt-one", code: "expired", error: null });
  await tick();
  assert.equal(controller.getSnapshot().phase, "ready");
  assert.equal(controller.getSnapshot().user, null);
  assert.ok(!controller.getSnapshot().error.includes("secret-error-body"));
});

test("browser launch failure frees receiver and verifier", async () => {
  const { controller, calls } = setup({ openFails: true });
  await controller.initialize();
  await controller.signIn();
  assert.equal(controller.getSnapshot().phase, "ready");
  assert.ok(controller.getSnapshot().error);
  assert.equal(calls.cancels, 1);
  assert.equal(calls.clears, 1);
});

test("browser callback is explicitly exchanged during initialization", async () => {
  const { controller, calls } = setup({ browserResult: { attemptId: "browser", code: "browser-code", error: null } });
  await controller.initialize();
  assert.deepEqual(calls.exchanges, ["browser-code"]);
  assert.equal(controller.getSnapshot().user.id, "user-one");
});

test("sign out clears this app's session; failure retains the current user", async () => {
  for (const signOutFails of [false, true]) {
    const { controller, calls } = setup({ session, signOutFails });
    await controller.initialize();
    await controller.signOut();
    assert.deepEqual(calls.signOut, [{ scope: "local" }]);
    assert.equal(controller.getSnapshot().user?.id ?? null, signOutFails ? "user-one" : null);
    assert.equal(Boolean(controller.getSnapshot().error), signOutFails);
  }
});
