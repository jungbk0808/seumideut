import assert from "node:assert/strict";
import test from "node:test";
import { readSupabaseConfig } from "../src/cloud/config.ts";

const valid = {
  VITE_SUPABASE_URL: "https://memo-test.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-key",
};

test("cloud config is optional for local-only desktop use", () => {
  assert.equal(readSupabaseConfig({}), null);
  assert.equal(readSupabaseConfig({ VITE_SUPABASE_URL: " " }), null);
  assert.throws(() => readSupabaseConfig({ VITE_SUPABASE_URL: valid.VITE_SUPABASE_URL }));
  assert.throws(() => readSupabaseConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: valid.VITE_SUPABASE_PUBLISHABLE_KEY }));
});

test("accepts a public key and an HTTPS project URL or local test server", () => {
  assert.deepEqual(readSupabaseConfig({
    VITE_SUPABASE_URL: ` ${valid.VITE_SUPABASE_URL}/ `,
    VITE_SUPABASE_PUBLISHABLE_KEY: ` ${valid.VITE_SUPABASE_PUBLISHABLE_KEY} `,
  }), { url: valid.VITE_SUPABASE_URL, publishableKey: valid.VITE_SUPABASE_PUBLISHABLE_KEY });
  for (const url of ["http://127.0.0.1:54321", "http://localhost:54321", "http://[::1]:54321"]) {
    assert.equal(readSupabaseConfig({ ...valid, VITE_SUPABASE_URL: url }).url, url);
  }
});

test("rejects secret keys, legacy JWTs, placeholders and invalid URLs without echoing values", () => {
  for (const key of ["sb_secret_private-value", "eyJhbGciOiJIUzI1NiJ9.private-value", "sb_publishable_<your-key>"]) {
    assert.throws(() => readSupabaseConfig({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: key }),
      (error) => !error.message.includes(key));
  }
  for (const url of ["not-a-url", "http://remote.example", "file:///tmp/test", "https://secret@example.com", "https://memo-test.supabase.co/auth/v1", "https://memo-test.supabase.co?token=secret", "https://memo-test.supabase.co#secret"]) {
    assert.throws(() => readSupabaseConfig({ ...valid, VITE_SUPABASE_URL: url }),
      (error) => !error.message.includes(url));
  }
});
