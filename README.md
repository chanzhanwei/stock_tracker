# stock_tracker

Single-ticker technical dashboard for ASX, NASDAQ, NYSE, SP500, and HKEX. It loads daily prices and key events when you ask for a ticker, then turns the indicators you switch on into a Buy, Hold, or Sell verdict. Mock prices and the mock institutional split stay off until the Mock data switch is on. Analyze reads a source or a pasted URL, runs OpenRouter, and saves the edited note. Institution lists those saved results.

**Not financial advice.** Nothing in this app is a recommendation to buy or sell a security.

## Run locally

```bash
npm install
npx vercel dev
```

Open the URL `vercel dev` prints (usually `http://localhost:3000`).

Without the Vercel CLI you can run the same API and static files with:

```bash
npm start
```

That listens on `http://127.0.0.1:4173`.

`npm run check` syntax-checks the JavaScript and runs the signal, allowlist, and data-route checks.

## Sign-in

Clerk is the only sign-in method: an email one-time code. There is no password and no social login.

Set these in Vercel, and in `.env.local` for `vercel dev`. Copy `.env.example`. Do not commit real keys.

| Name | Purpose |
| --- | --- |
| `CLERK_PUBLISHABLE_KEY` | Browser sign-in. Returned by `GET /api/config`. |
| `CLERK_SECRET_KEY` | Verifies the session and stores the allowlist. |
| `KV_REST_API_URL` and `KV_REST_API_TOKEN` | Optional Upstash Redis. Also accepts `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Used only if the Clerk allowlist cannot persist an add. |

In the Clerk application, keep email codes on and leave password, phone, and social providers off. Leave Clerk's restricted-mode allowlist **off**. This app checks its own allowlist after sign-in. Someone who can sign in but is not on the list sees a denied page instead of the dashboard.

The administrator is `chanzhanwei@gmail.com`, fixed in code. That account can add or remove other emails. Removing the administrator is refused. Addresses are stored in lowercase.

### Local bypass

If both Clerk keys are absent **and** the request host is `localhost` or `127.0.0.1`, the API treats the request as the administrator (or the address in the `x-dev-email` header). The allowlist is still enforced and is saved in `.data/allowlist.json`. This bypass is disabled whenever `VERCEL` is set, and it is disabled when either Clerk key is present. A production deployment without keys does not skip the allowlist: data routes return 401.

## Data

`GET /api/ohlcv` tries Yahoo's public daily chart API. Pass `mock=1` to fill a gap with a deterministic mock random walk seeded by `exchange:symbol`. With `mock=0` or the flag omitted, a miss returns `{ source: "none", bars: [] }`. The response `source` is `yahoo`, `mock`, or `none`. Events use Yahoo calendar and dividend fields when they are present. Mock fills, including AGM, are added only when `mock=1`. Institutional buy/sell is mock data only when `mock=1`; otherwise the payload is `{ source: "none", buyPct: null, sellPct: null }`. The desk sends the flag from the Mock data switch, which starts off, and the flag is part of the cache key.

Each load asks for the visible trading days plus 40 warmup days, converted with `ceil(n * 1.6) + 10` calendar days. The API clamps `days` to 1–3650 and defaults to 120.

Favorites are stored in `localStorage` under `stock_tracker.favorites.<email>`. They are never sent to the server.

## Analyze

The top bar switches between Stock, Analyze, and Institution. Stock stays the default. There is no daily automatic pull.

Only `chanzhanwei@gmail.com` can add a source, open a URL, fetch the next unprocessed item, analyse it, and save. Any other allowlisted email can read the saved rows on Institution.

A source is either one already saved, or a URL pasted on the desk. Add a source with a name and a kind: YouTube channel, X user, Substack, or website. Fetch reads the next item from a saved source that has not been analysed yet. A pasted URL opens that post, or the next unprocessed post when the URL is a channel, profile, or site. The publication is saved, and a post that has already been analysed is not opened again.

YouTube items come from the channel's public video RSS, or from the video page title when the URL is a single video. The app does not download captions; paste the transcript into the text box. An X user is read from the public FxEmbed timeline. A website or Substack is fetched from its URL, or from the RSS feed the page points at.

Analyse sends the text box to OpenRouter from the server. The key stays in `OPENROUTER_API_KEY` and is never sent to the browser. The default model is `deepseek/deepseek-v4.1-flash-1017`. After a call, that model's row shows the total, input, and output cost for the rest of the browser session. Costs stay blank before a call.

Save stores the edited result: the date, the source, the analyst name, a short-term stock, a long-term stock, a short-term industry, a long-term industry, a short-term stock to avoid, the post URL, the model id, and the three costs. The result needs an `Analyst:` line and those five pick lines. Use `none` when a line does not apply. Saving marks that post analysed, so a later fetch or the same URL skips it.

Institution lists the saved rows: date, source, analyst name, and the five picks. The source name links to the post.

Sources, analysed posts, and saved rows live in Neon Postgres through `DATABASE_URL`. The API creates the tables on the first request. The GitHub repo does not hold these rows.

Create these on the server (Vercel project settings, and `.env.local` for `vercel dev`) if they are not already there. Do not commit the values.

1. A Neon Postgres database, then set `DATABASE_URL` to its connection string.
2. An OpenRouter API key, then set `OPENROUTER_API_KEY`.

Charts use TradingView Lightweight Charts 4.1.3, vendored under `public/vendor/` (Apache License 2.0). The page does not load that library from a CDN.
