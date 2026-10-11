import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseConfig } from "./config";
import type { Database } from "./database.types";
import { invoke } from "@tauri-apps/api/core";

let client: SupabaseClient<Database> | undefined;

export function getAuthStorageKey(url: string) {
  return `seumideut.auth.${new URL(url).hostname}`;
}

export const nativeAuthStorage = {
  getItem: (key: string) => invoke<string | null>("auth_storage_get", { key }),
  setItem: (key: string, value: string) => invoke<void>("auth_storage_set", { key, value }),
  removeItem: (key: string) => invoke<void>("auth_storage_set", { key, value: null }),
};

// Only the full memo window owns native authentication; widgets stay local.
export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (client) return client;
  const config = readSupabaseConfig(import.meta.env);
  if (!config) return null;

  client = createClient<Database>(config.url, config.publishableKey, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      storageKey: getAuthStorageKey(config.url),
      storage: "__TAURI_INTERNALS__" in window ? nativeAuthStorage : window.localStorage,
      // Explicit callback exchange lets the UI surface errors and scrub the URL.
      detectSessionInUrl: false,
    },
  });
  return client;
}
