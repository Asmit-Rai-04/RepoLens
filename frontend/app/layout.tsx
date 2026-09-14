import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RepoLens — Codebase Intelligence",
  description: "Understand your codebase instantly.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}
