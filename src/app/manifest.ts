import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nadeef",
    short_name: "Nadeef",
    description: "Discover a simpler way to manage your space and keep everything feeling Nadeef.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f9fb",
    theme_color: "#0f766e",
    icons: [
      {
        src: "/nadeef-logo.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/nadeef-logo.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
