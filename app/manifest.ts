import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Arborline Logistics",
    short_name: "Arborline",
    description: "Automated freight brokerage operations platform",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#050d1c",
    theme_color: "#071326",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }
    ]
  };
}
