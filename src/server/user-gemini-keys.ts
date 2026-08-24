/**
 * Privileged CRUD for `private.user_gemini_keys` via service_role RPCs.
 * Always pass a user id from `getAuthenticatedUser()` — never from the client
 * body. The service_role key is server-only (no VITE_ prefix).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  decryptUserSecret,
  encryptUserSecret,
  hintFromApiKey,
  isUserKeyEncryptionConfigured,
} from "@/server/user-key-crypto";

let serviceClient: SupabaseClient | null | undefined;

function getServiceRoleClient(): SupabaseClient | null {
  if (serviceClient !== undefined) return serviceClient;

  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!url || !key) {
    serviceClient = null;
    return null;
  }

  serviceClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}

/** Encryption secret + service_role + Supabase URL are all present. */
export function isByokAvailable(): boolean {
  return (
    isUserKeyEncryptionConfigured() &&
    Boolean(process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim()) &&
    Boolean(import.meta.env.VITE_SUPABASE_URL?.trim())
  );
}

type StoredKeyRow = { encrypted_payload: string; key_hint: string };

function asStoredRow(data: unknown): StoredKeyRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const encrypted = (row as { encrypted_payload?: unknown }).encrypted_payload;
  const hint = (row as { key_hint?: unknown }).key_hint;
  if (typeof encrypted !== "string" || typeof hint !== "string") return null;
  return { encrypted_payload: encrypted, key_hint: hint };
}

export async function upsertEncryptedUserGeminiKey(
  userId: string,
  apiKey: string,
): Promise<string> {
  const client = getServiceRoleClient();
  if (!client) {
    throw new Error("BYOK store is not configured.");
  }

  const hint = hintFromApiKey(apiKey);
  const encryptedPayload = encryptUserSecret(apiKey, userId);
  const { error } = await client.rpc("service_upsert_user_gemini_key", {
    p_user_id: userId,
    p_encrypted_payload: encryptedPayload,
    p_key_hint: hint,
  });
  if (error) throw error;
  return hint;
}

export async function loadDecryptedUserGeminiKey(userId: string): Promise<string | null> {
  if (!isByokAvailable()) return null;

  const client = getServiceRoleClient();
  if (!client) return null;

  const { data, error } = await client.rpc("service_load_user_gemini_key", {
    p_user_id: userId,
  });
  if (error) throw error;

  const row = asStoredRow(data);
  if (!row) return null;

  return decryptUserSecret(row.encrypted_payload, userId);
}

export async function loadUserGeminiKeyHint(userId: string): Promise<string | null> {
  if (!isByokAvailable()) return null;

  const client = getServiceRoleClient();
  if (!client) return null;

  const { data, error } = await client.rpc("service_hint_user_gemini_key", {
    p_user_id: userId,
  });
  if (error) throw error;
  return typeof data === "string" && data.length > 0 ? data : null;
}

export async function deleteUserGeminiKeyRow(userId: string): Promise<void> {
  const client = getServiceRoleClient();
  if (!client) {
    throw new Error("BYOK store is not configured.");
  }

  const { error } = await client.rpc("service_delete_user_gemini_key", {
    p_user_id: userId,
  });
  if (error) throw error;
}
