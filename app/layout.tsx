import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./tso-theme.css";

export const metadata: Metadata = {
  title: "ArborLine Connect | Get More Commercial Customers",
  description: "Managed prospecting and outbound customer acquisition for commercial service businesses, launching with commercial cleaning.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/brand/arborline-badge.png", type: "image/png", sizes: "256x256" }]
  },
  appleWebApp: {
    capable: true,
    title: "ArborLine Connect",
    statusBarStyle: "black-translucent"
  }
};

export const viewport: Viewport = {
  themeColor: "#071326",
  colorScheme: "dark"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
