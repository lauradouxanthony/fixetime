// supabase/functions/sync/index.ts

// Charger les secrets
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BASE_URL = Deno.env.get("BASE_URL")!; // ← IMPORTANT : ton backend Next.js

if (!SUPABASE_URL || !SERVICE_ROLE || !BASE_URL) {
  console.error("❌ Missing required environment variables", {
    SUPABASE_URL: !!SUPABASE_URL,
    SERVICE_ROLE: !!SERVICE_ROLE,
    BASE_URL: !!BASE_URL,
  });
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Client Supabase (pour futur usage)
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// Fonction principale
Deno.serve(async () => {
  console.log("➡️ Edge Function SYNC started");

  try {
    // 🔥 Appelle ton backend Next.js
    const gmail = await fetch(`${BASE_URL}/api/gmail/sync`);
    const calendar = await fetch(`${BASE_URL}/api/calendar/sync`);

    return new Response(
      JSON.stringify({
        success: true,
        gmail_status: gmail.status,
        calendar_status: calendar.status,
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("❌ SYNC FAILED:", err);
    return new Response(
      JSON.stringify({ error: "EDGE_FUNCTION_ERROR", details: String(err) }),
      { status: 500 }
    );
  }
});
