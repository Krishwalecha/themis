import { SITE } from "../seo";

const meta = (attr: "name" | "property", key: string, content: string) => {
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
};

// The tab title, description and canonical address, and whether search engines may index the page.
// Public pages point their canonical (and link previews) at themselves; the signed-in app isn't indexed at all.
export const setPageMeta = (title: string, index: boolean, description?: string) => {
  document.title = title;
  meta("name", "robots", index ? "index, follow, max-image-preview:large" : "noindex, nofollow");
  const url = SITE + (location.pathname.replace(/\/+$/, "") || "/");
  let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (index) {
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = url;
  } else canonical?.remove();
  meta("property", "og:url", url);
  meta("property", "og:title", title);
  meta("name", "twitter:title", title);
  if (description) {
    meta("name", "description", description);
    meta("property", "og:description", description);
    meta("name", "twitter:description", description);
  }
};
