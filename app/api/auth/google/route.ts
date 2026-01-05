import { NextResponse } from "next/server";

export async function GET() {
  // 🔒 Désactivation temporaire du OAuth Google manuel
  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_SITE_URL}/auth/login?google=disabled`
  );
}
