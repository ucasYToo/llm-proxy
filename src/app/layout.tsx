import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM Proxy",
  description: "本地 LLM API 代理，支持目标管理和请求日志",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
