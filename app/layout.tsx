import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./tso-theme.css";

export const metadata: Metadata = {
  title: "Arborline Logistics",
  description: "Automated freight brokerage operations platform",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Arborline",
    statusBarStyle: "black-translucent"
  }
};

export const viewport: Viewport = {
  themeColor: "#071326",
  colorScheme: "dark"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
