import assert from "node:assert/strict";
import test from "node:test";
import { consumeBrowserOAuth } from "../src/cloud/browserOAuth.ts";

const now = 1_000_000;
const pending = JSON.stringify({ attemptId: "nonce", startedAt: now - 1000 });
const callback = "http://127.0.0.1:1420/?view=full&panel=settings&authAttempt=nonce&code=private-code";

test("browser callback verifies the tab's pending request and removes the code", () => {
  const { result, cleanUrl } = consumeBrowserOAuth(callback, pending, now);
  assert.deepEqual(result, { attemptId: "nonce", code: "private-code", error: null });
  assert.equal(cleanUrl, "http://127.0.0.1:1420/?view=full&panel=settings");
});

test("invalid, mismatched, expired and future requests cannot exchange codes", () => {
  for (const stored of [null, "invalid-json", "null", "1", JSON.stringify({ attemptId: "other", startedAt: now }), JSON.stringify({ attemptId: "nonce", startedAt: now - 300_000 }), JSON.stringify({ attemptId: "nonce", startedAt: now + 1 })]) {
    const { result, cleanUrl } = consumeBrowserOAuth(callback, stored, now);
    assert.equal(result.code, null);
    assert.equal(result.error, "timeout");
    assert.ok(!cleanUrl.includes("private-code"));
  }
  assert.equal(consumeBrowserOAuth(`${callback}&code=duplicate`, pending, now).result.code, null);
});

test("provider query and fragment errors are consumed without retaining private URLs", () => {
  for (const suffix of ["&error=access_denied&error_description=private", "#error=access_denied&error_description=private&access_token=private-token"]) {
    const { result, cleanUrl } = consumeBrowserOAuth(`http://127.0.0.1:1420/?view=full&panel=settings&authAttempt=nonce${suffix}`, pending, now);
    assert.equal(result.error, "access_denied");
    assert.ok(!cleanUrl.includes("private"));
    assert.ok(!cleanUrl.includes("nonce"));
  }
});

test("ordinary editor navigation is unchanged", () => {
  const href = "http://127.0.0.1:1420/?view=full&noteId=note-one#section";
  assert.deepEqual(consumeBrowserOAuth(href, null, now), { result: null, cleanUrl: href });
});
