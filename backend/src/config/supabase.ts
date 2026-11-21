import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { env } from "./env.js";

// Service-role client: bypasses RLS. Backend-only, never expose to the frontend.
// Node < 22 has no native WebSocket, so the realtime client needs the `ws` polyfill.
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
  realtime: { transport: ws as any },
});
