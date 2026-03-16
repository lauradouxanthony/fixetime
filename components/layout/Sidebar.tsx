"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Mail,
  CalendarDays,
  Settings,
  LogOut,
  Users,
  MessageSquare,
  Building2,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { useRouter } from "next/navigation";

const navItems = [
  { label: "Tableau de bord", href: "/home", icon: LayoutDashboard },
  { label: "Pipeline emails", href: "/emails", icon: Mail, badge: true },
  { label: "Prospects", href: "/leads", icon: Users },
  { label: "Mes biens", href: "/properties", icon: Building2 },
  { label: "Calendrier", href: "/calendar", icon: CalendarDays },
  { label: "Chat IA", href: "/chat", icon: MessageSquare },
  { label: "Paramètres", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const supabase = supabaseBrowser();

    const fetchUnread = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { count } = await supabase
        .from("emails")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_archived", false);
      setUnreadCount(count ?? 0);
    };

    fetchUnread();
    const interval = setInterval(fetchUnread, 60_000);
    return () => clearInterval(interval);
  }, []);

  async function handleLogout() {
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-white" style={{ borderColor: "rgb(226 232 240)" }}>
      {/* Logo / Brand */}
      <div className="flex flex-col px-5 py-4 border-b" style={{ borderColor: "rgb(226 232 240)" }}>
        <img src="/logo-fixtime.png" alt="FixTime" className="h-14 w-auto object-contain self-start" />
        <span className="text-xs font-medium mt-0.5" style={{ color: "rgb(79 70 229)" }}>Assistant IA</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const showBadge = item.badge && unreadCount > 0;

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150"
              style={isActive ? {
                background: "rgb(238 242 255)",
                color: "rgb(79 70 229)",
                fontWeight: 500,
              } : {
                color: "rgb(71 85 105)",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = "rgb(248 250 252)";
                  (e.currentTarget as HTMLElement).style.color = "rgb(30 41 59)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "rgb(71 85 105)";
                }
              }}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{item.label}</span>
              {showBadge && (
                <span
                  className="text-xs font-semibold px-1.5 py-0.5 rounded-full text-white leading-none"
                  style={{
                    background: "rgb(79 70 229)",
                    minWidth: "18px",
                    textAlign: "center",
                  }}
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer / logout */}
      <div className="border-t px-3 py-3" style={{ borderColor: "rgb(226 232 240)" }}>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-150"
          style={{ color: "rgb(100 116 139)" }}
          onClick={handleLogout}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgb(254 242 242)";
            (e.currentTarget as HTMLElement).style.color = "rgb(220 38 38)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "rgb(100 116 139)";
          }}
        >
          <LogOut className="h-4 w-4" />
          <span>Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}
