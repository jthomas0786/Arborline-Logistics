import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ArborLine Logistics",
    short_name: "ArborLine",
    description: "Automated freight brokerage operations platform",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#050d1c",
    theme_color: "#071326",
    icons: [
      { src: "/brand/arborline-badge.png", sizes: "256x256", type: "image/png", purpose: "any" },
      { src: "/brand/arborline-badge.png", sizes: "256x256", type: "image/png", purpose: "maskable" }
    ]
  };
}
