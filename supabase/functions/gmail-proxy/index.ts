// supabase/functions/gmail-proxy/index.ts
// Proxy sécurisé exécuté sur Supabase Edge Function
// Appelle ton API locale Gmail : /api/gmail/sync

import type { ServeHandler } from "https://deno.land/std@0.168.0/http/server.ts";

const handler: ServeHandler = async (req) => {
  try {
    const baseUrl = Deno.env.get("BASE_URL");
    if (!baseUrl) {
      return new Response(
        JSON.stringify({ error: "Missing BASE_URL in Edge Function" }),
        { status: 500 }
      );
    }

    const response = await fetch(`${baseUrl}/api/gmail/sync`, {
      method: "GET",
    });

    const json = await response.json();

    return new Response(JSON.stringify(json), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("EDGE GMAIL ERROR:", err);
    return new Response(JSON.stringify({ error: "EDGE_GMAIL_FAILED" }), {
      status: 500,
    });
  }
};

Deno.serve(handler);
