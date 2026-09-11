import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * IMPORTANT: do NOT aggressively split react / react-dom into custom
 * manualChunks. A bad split caused production white-screen:
 *   TypeError: Cannot read properties of undefined (reading 'useState')
 * Leave React to Vite's default graph so one consistent instance loads first.
 * Admin (recharts) stays lazy via dynamic import() in AkaraApp.jsx.
 * Invoice PDF stays lazy via dynamic import() of jspdf.
 */
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: "strip-html-comments-in-build",
      apply: "build",
      transformIndexHtml(html) {
        let out = html.replace(/<!--[\s\S]*?-->/g, "");
        out = out.replace(/<script(?![^>]*data-cfasync)/gi, '<script data-cfasync="false"');
        return out;
      },
    },
  ],
  build: {
    outDir: "dist",
    target: "es2020",
    minify: "esbuild",
    cssMinify: true,
    cssCodeSplit: true,
    sourcemap: false,
    reportCompressedSize: true,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 900,
    // No manualChunks — Vite + dynamic import() handle code-splitting safely.
  },
  esbuild: {
    // Keep console.error in prod so boundary/debug still works; drop only debugger
    drop: mode === "production" ? ["debugger"] : [],
    legalComments: "none",
  },
}));
