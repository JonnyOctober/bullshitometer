# Bullshitometer

A claim-analysis tool. Paste a pitch, post, press release, link, or screenshot;
it breaks the content into discrete claims, verifies the checkable ones with web
search, scores each 0–100 for bullshit, and shows an overall reading on a gauge
plus a claim-by-claim breakdown.

React + Vite front end with a small Express server that holds the Anthropic API
key and proxies requests — the key never reaches the browser.

## What it takes

- **Text** — paste anything.
- **Links** — the server unfurls the URL's Open Graph image + caption and feeds
  them in, so social/article links get analyzed (login-walled posts like
  Instagram won't unfurl — drop a screenshot for those).
- **Images / screenshots** — drag, paste, or pick; read via vision, including
  any text in the image.

## Setup

```bash
npm install
cp .env.example .env      # add your key — get one at console.anthropic.com/settings/keys
npm run dev
```

`npm run dev` runs both: Vite (UI) on http://localhost:5173 ← open this, and
Express (API) on http://localhost:8787. Vite proxies `/api/*` to Express.

## Production

```bash
npm run build     # builds the UI into dist/
npm start         # Express serves dist/ AND the API on one port (8787)
```

Deploy it behind any reverse proxy / tunnel that can reach the Express port.

## Configuration

- `ANTHROPIC_API_KEY` (required) — in `.env`.
- `PORT` (optional) — Express port, default `8787`.
- **Model tiers** — the UI's Fast / Balanced / Thorough picker maps to
  Haiku / Sonnet / Opus in the `TIERS` table at the top of
  [server/index.js](server/index.js); Balanced (Sonnet) is the default.
- **Optional access gate** — set `REQUIRE_AUTH=1` and `PERMISSIONS_DB=/path/to.db`
  to gate every request behind a Cloudflare-Access email + a per-tool grant in a
  shared SQLite DB (see [server/auth.js](server/auth.js)). Unset → open.
