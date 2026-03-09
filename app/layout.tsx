import "./globals.css";
import type { Metadata } from "next";
import SettingsBoot from "@/components/providers/SettingsBoot";
import { ToastProvider } from "@/components/ui/Toast";

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
    <html lang="fr" suppressHydrationWarning>
      <body className="min-h-screen">
        <ToastProvider>
          <SettingsBoot>{children}</SettingsBoot>
        </ToastProvider>
      </body>
    </html>
  );
}
