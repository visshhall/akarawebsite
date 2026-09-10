import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "strip-html-comments-in-build",
      apply: "build",
      transformIndexHtml(html) {
        // Strip developer comments from production HTML
        let out = html.replace(/<!--[\s\S]*?-->/g, "");
        // Cloudflare Rocket Loader rewrites type="module" → type="<hash>-module"
        // which breaks React if Rocket Loader is on/slow. data-cfasync="false"
        // opts every script out of Rocket Loader.
        out = out.replace(/<script(?![^>]*data-cfasync)/gi, '<script data-cfasync="false"');
        return out;
      },
    },
  ],
  build: {
    outDir: "dist",
  },
});
