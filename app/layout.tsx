 import "./globals.css";
import type { Metadata } from "next";
import SettingsBoot from "@/components/providers/SettingsBoot";

export const metadata: Metadata = {
  title: "FixTime – Assistant IA",
  description: "Optimisez vos emails et votre calendrier avec l'IA.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" suppressHydrationWarning className="dark">
      <body className="min-h-screen bg-background text-foreground">
        <SettingsBoot>
          {children}
        </SettingsBoot>
      </body>
    </html>
  );
}

