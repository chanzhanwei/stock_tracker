# stock_tracker

Single-ticker technical dashboard for ASX, NASDAQ, NYSE, SP500, and HKEX. It loads daily prices and key events when you ask for a ticker, then turns the indicators you switch on into a Buy, Hold, or Sell verdict. Mock prices, the mock institutional split, and the Institution tape stay off until the Mock data switch is on. Institution is a second screen of illustrative ownership signals.

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

Charts use TradingView Lightweight Charts 4.1.3, vendored under `public/vendor/` (Apache License 2.0). The page does not load that library from a CDN.
