import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FixTime – Assistant IA",
  description: "Optimisez vos emails et votre calendrier avec l'IA.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
