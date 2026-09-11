import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react-dom") || id.includes("/react/") || id.includes("\\react\\")) {
              return "react-vendor";
            }
            if (id.includes("recharts") || id.includes("/d3-") || id.includes("\\d3-")) {
              return "charts-vendor";
            }
            if (id.includes("jspdf")) {
              return "pdf-vendor";
            }
            if (id.includes("lucide-react")) {
              return "icons-vendor";
            }
            return "vendor";
          }
        },
      },
    },
  },
  esbuild: {
    drop: mode === "production" ? ["console", "debugger"] : [],
    legalComments: "none",
  },
}));
