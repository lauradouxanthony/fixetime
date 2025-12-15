// lib/supabaseServer.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function supabaseServer() {
  const cookieStore = cookies(); // In Next.js 16, this is async-like

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: async (name: string) => {
          const all = await cookieStore;
          const cookie = all.get(name);
          return cookie?.value;
        },
        getAll: async () => {
          const all = await cookieStore;
          return all.getAll().map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
          }));
        },
        // Next.js 16 doesn't allow setting cookies from RSC safely → no-op
        set: async () => {},
        setAll: async () => {},
        remove: async () => {},
      },
    }
  );
}
