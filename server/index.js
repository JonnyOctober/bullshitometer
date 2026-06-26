import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { getUserEmail, checkAccess } from "./auth.js";
import { extractUrls, fetchLinkContext } from "./linkContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;

// When REQUIRE_AUTH=1 (production/mini), gate every request against the shared
// permissions.db. Unset locally → open for dev.
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === "1";
const TOOL_SLUG = "bullshitometer";

// Model tiers the UI can request. Newer web tools (dynamic filtering) need a
// 4.6+ model, so Haiku uses the basic web_search and skips web_fetch (the
// server-side link unfurler already covers fetching). Haiku rejects the effort
// param, so its thinking/effort are omitted.
const WEB_NEW = [
  { type: "web_search_20260209", name: "web_search" },
  { type: "web_fetch_20260209", name: "web_fetch" },
];
const WEB_BASIC = [{ type: "web_search_20250305", name: "web_search" }];
const TIERS = {
  fast: { model: "claude-haiku-4-5", tools: WEB_BASIC },
  balanced: { model: "claude-sonnet-4-6", thinking: { type: "adaptive" }, effort: "medium", tools: WEB_NEW },
  thorough: { model: "claude-opus-4-8", thinking: { type: "adaptive" }, effort: "high", tools: WEB_NEW },
};
const DEFAULT_TIER = "balanced";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const MAX_IMAGES = 8;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "\n  Missing ANTHROPIC_API_KEY.\n  Copy .env.example to .env and add your key.\n"
  );
  process.exit(1);
}

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const buildPrompt = (text, imageCount, linkText) => {
  const material =
    imageCount > 0 && !text
      ? `MATERIAL TO ANALYZE: see the ${imageCount} attached image(s).`
      : `MATERIAL TO ANALYZE:\n${text}${
          imageCount > 0 ? `\n\n(plus ${imageCount} attached image(s))` : ""
        }`;

  const fetched = linkText
    ? `\n\nAUTO-RETRIEVED FROM THE LINK(S) ABOVE (preview metadata + the post's image, already attached):\n${linkText}\n`
    : "";

  return `You are a rigorous claims analyst. Analyze the material below — it may include pasted text, links/URLs, and/or attached images (e.g. screenshots of posts, ads, or articles). Break it into its discrete factual or quasi-factual claims.

- Link content is already retrieved for you below (caption/title + the post image is attached). Analyze that. You may also use web_fetch for additional pages and web_search to verify.
- If images are attached, read them carefully — including any text shown in the image — and treat their claims as part of the material.
- Use web_search to verify checkable claims.
- If you cannot access the linked content and no other substantive material is provided, do NOT invent claims. Return an empty "claims" array, an "overall_score" of 0, and a short "verdict" noting the source couldn't be read.

For each claim, assign a bullshit score from 0 (verifiably solid) to 100 (pure bullshit), considering: verifiability, plausibility, hype language vs. substance, missing context, and whether evidence exists.

Rating bands: 0-24 solid, 25-49 stretch, 50-74 dubious, 75-100 bullshit.

Respond with ONLY a raw JSON object, no markdown fences, no preamble:
{
  "overall_score": <0-100, weighted by how central each claim is>,
  "verdict": "<one short punchy line>",
  "summary": "<2-3 sentences on the overall pattern>",
  "claims": [
    {
      "claim": "<the claim, paraphrased concisely>",
      "score": <0-100>,
      "rating": "<solid|stretch|dubious|bullshit>",
      "analysis": "<2-3 sentences: why this rating>",
      "evidence": "<what supports or contradicts it, or what would be needed to verify>"
    }
  ]
}

${material}${fetched}`;
};

const app = express();
app.use(express.json({ limit: "25mb" })); // base64 images inflate payloads

// Access gate. On the mini (REQUIRE_AUTH=1) every request must come from a
// Cloudflare-authenticated user who has the `bullshitometer` grant in the
// shared permissions.db. Local dev leaves REQUIRE_AUTH unset → open.
if (REQUIRE_AUTH) {
  app.use((req, res, next) => {
    const email = getUserEmail(req);
    if (checkAccess(email, TOOL_SLUG)) return next();
    res
      .status(403)
      .type("html")
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><title>Access Restricted</title>` +
          `<style>html{background:#0D0E11;color:#E8E6DF;font-family:ui-monospace,Menlo,monospace}` +
          `.box{max-width:420px;margin:18vh auto;text-align:center;padding:0 24px}` +
          `a{color:#FFB224}</style></head><body><div class="box">` +
          `<div style="font-size:32px">🔒</div><h1>Access Restricted</h1>` +
          `<p>You don't have access to the Bullshitometer.<br>Ask the admin to grant it.</p>` +
          `<p style="color:#8B8F98">${(email || "not signed in").replace(/[<>&]/g, "")}</p>` +
          `<p><a href="https://tools.makeshift.so">← makeshift tools</a></p>` +
          `</div></body></html>`
      );
  });
}

app.post("/api/analyze", async (req, res) => {
  const text = (req.body?.text ?? "").toString().trim();
  const rawImages = Array.isArray(req.body?.images) ? req.body.images : [];
  const tier = TIERS[req.body?.tier] ? req.body.tier : DEFAULT_TIER;

  if (!text && rawImages.length === 0) {
    return res.status(400).json({ error: "Provide text, a link, or an image." });
  }

  // Validate + build image content blocks.
  const imageBlocks = [];
  for (const img of rawImages.slice(0, MAX_IMAGES)) {
    if (!img || !ALLOWED_IMAGE_TYPES.has(img.media_type) || typeof img.data !== "string") {
      return res
        .status(400)
        .json({ error: "Unsupported image. Use PNG, JPEG, GIF, or WebP." });
    }
    imageBlocks.push({
      type: "image",
      source: { type: "base64", media_type: img.media_type, data: img.data },
    });
  }

  try {
    // Unfurl any URLs server-side: attach the post image + caption so social /
    // login-walled links (Instagram, X, …) actually get analyzed.
    const urls = extractUrls(text);
    const linkContexts = (await Promise.all(urls.map(fetchLinkContext))).filter(Boolean);
    for (const lc of linkContexts) {
      if (lc.image && imageBlocks.length < MAX_IMAGES) {
        imageBlocks.push({
          type: "image",
          source: { type: "base64", media_type: lc.image.media_type, data: lc.image.data },
        });
      }
    }
    const linkText = linkContexts
      .map((lc) => `From ${lc.url}:\n${lc.text}`)
      .filter(Boolean)
      .join("\n\n");

    // Nothing readable: only an unfetchable link (no image, no caption) and no
    // real commentary. Skip the model and say so plainly — don't fabricate.
    const textSansUrls = urls.reduce((s, u) => s.split(u).join(" "), text).trim();
    if (imageBlocks.length === 0 && !linkText && textSansUrls.length < 25) {
      return res.status(422).json({
        error: "Couldn't read that link — it may be behind a login wall. Try pasting a screenshot.",
      });
    }

    // Images first, then the instruction text — Claude reads them together.
    const content = [
      ...imageBlocks,
      { type: "text", text: buildPrompt(text, imageBlocks.length, linkText) },
    ];

    // web_search + web_fetch are server-side tools: Anthropic runs the loop.
    // If it hits its iteration limit it returns stop_reason "pause_turn"; we
    // re-send to let it continue.
    const t = TIERS[tier];
    const baseParams = { model: t.model, max_tokens: 16000, tools: t.tools };
    if (t.thinking) baseParams.thinking = t.thinking;
    if (t.effort) baseParams.output_config = { effort: t.effort };

    const messages = [{ role: "user", content }];
    let response;
    for (let i = 0; i < 5; i++) {
      response = await client.messages.create({ ...baseParams, messages });
      if (response.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: response.content });
    }

    const textOut = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const start = textOut.indexOf("{");
    const end = textOut.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return res
        .status(502)
        .json({ error: "No structured result returned. Try again." });
    }

    let parsed;
    try {
      parsed = JSON.parse(textOut.slice(start, end + 1));
    } catch {
      return res
        .status(502)
        .json({ error: "Could not parse the analysis. Try again." });
    }

    res.json(parsed);
  } catch (e) {
    console.error("Analyze failed:", e);
    const status = typeof e?.status === "number" ? e.status : 500;
    res.status(status).json({ error: e?.message || "Analysis failed." });
  }
});

// In production (after `npm run build`), serve the built frontend from the
// same Express process so there's one thing to deploy.
const dist = path.join(__dirname, "..", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`Bullshitometer API listening on http://localhost:${PORT}`);
});
