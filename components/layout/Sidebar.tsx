"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Mail,
  CalendarDays,
  Settings,
  LogOut,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { useRouter } from "next/navigation";

const navItems = [
  { label: "Tableau de bord", href: "/home", icon: LayoutDashboard },
  { label: "Pipeline emails", href: "/emails", icon: Mail },
  { label: "Calendrier", href: "/calendar", icon: CalendarDays },
  { label: "Paramètres", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-white" style={{ borderColor: "rgb(226 232 240)" }}>
      {/* Logo / Brand */}
      <div className="flex items-center gap-3 px-5 py-5 border-b" style={{ borderColor: "rgb(226 232 240)" }}>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg text-white text-sm font-bold" style={{ background: "rgb(79 70 229)" }}>
          FT
        </div>
        <div className="flex flex-col">
          <span className="font-semibold text-sm tracking-tight" style={{ color: "rgb(30 41 59)" }}>FixTime</span>
          <span className="text-xs" style={{ color: "rgb(100 116 139)" }}>Agence IA</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

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
              <span>{item.label}</span>
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
