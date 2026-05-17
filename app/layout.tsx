import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "Tay";

export const metadata: Metadata = {
  title: appName,
  description: "Self-hosted AI BDR agent. Your data stays yours.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-white text-gray-900">
        <Nav />
        {children}
      </body>
    </html>
  );
}
