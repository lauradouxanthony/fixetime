import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";

export async function POST() {
  try {
    // 1) Base URL dynamique (local + prod)
    const headersList = await headers();
    const host = headersList.get("host");
    const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
    const baseUrl = `${protocol}://${host}`;

    // 2) Cookies (session Supabase)
    const cookieStore = await cookies();
    const cookieHeader = cookieStore
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    console.log("[SYNC ALL] Base URL:", baseUrl);
    console.log("[SYNC ALL] Starting global sync");

    // 3) Gmail sync
    const gmailRes = await fetch(`${baseUrl}/api/gmail/sync`, {
      method: "POST",
      headers: { cookie: cookieHeader },
    });
    

    if (!gmailRes.ok) {
      const text = await gmailRes.text();
      console.error("[SYNC ALL] Gmail sync failed:", text);
      return NextResponse.json(
        { error: "Gmail sync failed" },
        { status: 500 }
      );
    }

    console.log("[SYNC ALL] Gmail sync OK");

    // 4) Calendar sync
    const calendarRes = await fetch(`${baseUrl}/api/calendar/sync`, {
      method: "POST",
      headers: { cookie: cookieHeader },
    });
    

    if (!calendarRes.ok) {
      const text = await calendarRes.text();
      console.error("[SYNC ALL] Calendar sync failed:", text);
      return NextResponse.json(
        { error: "Calendar sync failed" },
        { status: 500 }
      );
    }

    console.log("[SYNC ALL] Calendar sync OK");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[SYNC ALL] Global sync error:", error);
    return NextResponse.json(
      { error: "Global sync failed" },
      { status: 500 }
    );
  }
}
