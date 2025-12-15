import { cookies } from "next/headers";
import { createServerClient } from "@supabase/auth-helpers-nextjs";

export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          const cookie = cookieStore.get(name);
          return cookie?.value ?? null; // NEXT.JS 16 : renvoyer la valeur uniquement
        },
        set(name: string, value: string, options?: any) {
          try {
            cookieStore.set(name, value, options); // OK
          } catch {
            // Ignorer en edge runtime
          }
        },
        remove(name: string) {
          try {
            cookieStore.delete(name); // ⭐ NEXT.JS 16 : UN SEUL PARAMÈTRE
          } catch {
            // Ignorer les erreurs edge
          }
        },
      },
    }
  );
}
