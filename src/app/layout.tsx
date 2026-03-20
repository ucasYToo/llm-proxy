import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM Proxy",
  description: "Local LLM API proxy with target management and request logging",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
