import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !secretKey) {
  console.warn("[SUPABASE CONFIG MISSING] SUPABASE_URL and SUPABASE_SECRET_KEY are required for storage uploads");
}

export const supabase = createClient(supabaseUrl || "http://localhost:54321", secretKey || "missing-supabase-secret-key", {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
