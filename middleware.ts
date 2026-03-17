import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ONBOARDING_ALLOWLIST_PREFIXES = [
  "/onboarding",
  "/auth",
  "/api/auth",
  "/api/google",
  "/api/gmail",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Guard onboarding : seulement en production pour ne pas gêner le dev.
  const isProd = process.env.NODE_ENV === "production";
  const isAllowlisted = ONBOARDING_ALLOWLIST_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  );

  if (isProd && user && !isAllowlisted) {
    const [{ data: gmail }, { data: microsoft }] = await Promise.all([
      supabaseAdmin
        .from("gmail_tokens")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabaseAdmin
        .from("microsoft_tokens")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const hasGmail = !!gmail?.user_id;
    const hasMicrosoft = !!microsoft?.user_id;

    if (!hasGmail && !hasMicrosoft) {
      if (process.env.NODE_ENV === "development") {
        console.log("[ONBOARDING_GUARD]", {
          path: pathname,
          userId: user.id,
          hasGmail,
          hasMicrosoft,
          action: "redirect:/onboarding",
        });
      }
      return NextResponse.redirect(new URL("/onboarding", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
