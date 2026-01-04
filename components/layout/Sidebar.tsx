"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Mail,
  CalendarDays,
  BotMessageSquare,
  CheckSquare,
  Settings,
  CreditCard,
  LogOut,
} from "lucide-react";

const navItems = [
  { label: "Home", href: "/home", icon: LayoutDashboard },
  { label: "Emails", href: "/emails", icon: Mail },
  { label: "Calendrier", href: "/calendar", icon: CalendarDays },
  { label: "Paramètres", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-slate-800 bg-slate-950/95 text-slate-100">
      {/* Logo / Brand */}
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-800">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500 text-sm font-bold">
          FT
        </div>
        <div className="flex flex-col">
          <span className="font-semibold tracking-tight">FixTime</span>
          <span className="text-xs text-slate-400">
            Assistant de direction IA
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition
              ${isActive
                ? "bg-slate-800 text-slate-50"
                : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-50"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer / logout */}
      <div className="border-t border-slate-800 px-3 py-3">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-900 hover:text-red-300 transition"
          // TODO: on implémentera la vraie déconnexion plus tard
          onClick={() => {
            window.location.href = "/auth/login";
          }}
        >
          <LogOut className="h-4 w-4" />
          <span>Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}
