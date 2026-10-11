import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { SEO, SITE } from "./src/seo";

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Gives each public page its own HTML file (privacy.html, try.html…) with its own title, description, canonical
// and preview tags, so search engines see the right page even before JavaScript runs. The homepage's FAQ data stays
// on the homepage, since structured data has to match what the page shows.
const pageHeads = (): Plugin => ({
  name: "themis-page-heads",
  apply: "build",
  closeBundle() {
    const dist = join(import.meta.dirname, "dist");
    const home = readFileSync(join(dist, "index.html"), "utf8");
    for (const [path, { title, description }] of Object.entries(SEO)) {
      if (path === "/") continue;
      const html = home
        .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
        .replace(/(name="description"\s+content=")[^"]*/, `$1${attr(description)}`)
        .replace(/(property="og:description" content=")[^"]*/, `$1${attr(description)}`)
        .replace(/(name="twitter:description" content=")[^"]*/, `$1${attr(description)}`)
        .replace(/(property="og:title" content=")[^"]*/, `$1${attr(title)}`)
        .replace(/(name="twitter:title" content=")[^"]*/, `$1${attr(title)}`)
        .replace(/(rel="canonical" href=")[^"]*/, `$1${SITE}${path}`)
        .replace(/(property="og:url" content=")[^"]*/, `$1${SITE}${path}`)
        .replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/, "")
        .replace(/\s*<noscript>[\s\S]*?<\/noscript>/, "");
      writeFileSync(join(dist, `${path.slice(1)}.html`), html);
    }
  },
});

export default defineConfig(({ mode }) => {
  // client/.env holds the client's own settings (the server has server/.env).
  const env = loadEnv(mode, import.meta.dirname, "");
  return {
    // Tailwind only generates utilities for the landing page (see src/landing/styles.css).
    plugins: [react(), tailwindcss(), pageHeads()],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: env.VITE_THEMIS_API_URL || "http://localhost:4000", changeOrigin: true },
      },
    },
  };
});
