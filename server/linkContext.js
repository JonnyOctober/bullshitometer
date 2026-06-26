// Server-side link unfurling. When the user pastes a URL, fetch it ourselves
// and pull the Open Graph / Twitter-card preview (image + caption/title). This
// gets the real content for Instagram/X/Facebook/articles — OG tags are what
// platforms expose to link-preview bots, so they survive the login wall that
// blocks an anonymous web_fetch of the page body.
//
// Returns { url, text, image? } per URL, or null on failure (fail-soft —
// analysis proceeds without it). Guards against SSRF to local/private hosts.

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ALLOWED_IMG = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_URLS = 3;
const MAX_IMG_BYTES = 4_500_000; // keep under the API's per-image limit
const FETCH_MS = 12000;

export function extractUrls(text) {
  if (!text) return [];
  const found = (text.match(URL_RE) || []).map((u) => u.replace(/[.,;)]+$/, ""));
  return [...new Set(found)].slice(0, MAX_URLS);
}

function isBlockedHost(host) {
  host = (host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal"))
    return true;
  if (host === "::1") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host) || /^0\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

function meta(html, ...names) {
  for (const n of names) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tag = html.match(
      new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*>`, "i")
    );
    if (tag) {
      const c = tag[0].match(/content=["']([^"']*)["']/i);
      if (c && c[1].trim()) return decodeEntities(c[1].trim());
    }
  }
  return "";
}

async function timedFetch(url, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    return await fetch(url, { headers, redirect: "follow", signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchImage(src, base) {
  try {
    const iu = new URL(src, base);
    if (!/^https?:$/.test(iu.protocol) || isBlockedHost(iu.hostname)) return null;
    const res = await timedFetch(iu.href, { "User-Agent": UA });
    if (!res.ok) return null;
    let ct = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_IMG_BYTES || buf.byteLength === 0) return null;
    if (!ALLOWED_IMG.includes(ct)) {
      if (/\.png(\?|#|$)/i.test(iu.pathname)) ct = "image/png";
      else if (/\.(jpe?g)(\?|#|$)/i.test(iu.pathname)) ct = "image/jpeg";
      else if (/\.gif(\?|#|$)/i.test(iu.pathname)) ct = "image/gif";
      else if (/\.webp(\?|#|$)/i.test(iu.pathname)) ct = "image/webp";
      else return null;
    }
    return { media_type: ct, data: buf.toString("base64") };
  } catch {
    return null;
  }
}

export async function fetchLinkContext(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || isBlockedHost(u.hostname)) return null;
  try {
    const res = await timedFetch(u.href, {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,*/*",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html")) return null;
    const html = (await res.text()).slice(0, 600_000);

    const title =
      meta(html, "og:title", "twitter:title") ||
      (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "").trim();
    const desc = meta(html, "og:description", "twitter:description", "description");
    const site = meta(html, "og:site_name");
    const imgUrl = meta(html, "og:image:secure_url", "og:image", "twitter:image", "og:image:url");

    const text = [
      site && `Source: ${site}`,
      title && `Title: ${title}`,
      desc && `Caption/description: ${desc}`,
    ]
      .filter(Boolean)
      .join("\n");

    const image = imgUrl ? await fetchImage(imgUrl, u) : null;
    // A bare title (no description, no image) isn't analyzable — that's what a
    // login wall returns (e.g. Instagram → just "Instagram"). Treat as nothing.
    if (!image && !desc) return null;
    return { url: u.href, text, image };
  } catch {
    return null;
  }
}
