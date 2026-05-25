import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false },
    });
  }
  return _client;
}
