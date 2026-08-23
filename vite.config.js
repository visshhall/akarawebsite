import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    // Found in an independent security review (M-13): explanatory
    // comments meant for developers reading the source were shipping
    // verbatim into the built index.html, visible to any visitor via a
    // plain "View Source" — no vulnerability on its own, but genuinely
    // useful free reconnaissance for an attacker (real file/function
    // names, past bug history, internal architecture reasoning), with
    // zero effort required to see it. apply:"build" means this ONLY
    // strips comments from the production build — running `npm run dev`
    // locally still shows every comment exactly as written.
    {
      name: "strip-html-comments-in-build",
      apply: "build",
      transformIndexHtml(html) {
        return html.replace(/<!--[\s\S]*?-->/g, "");
      },
    },
  ],
  build: {
    outDir: "dist",
  },
});