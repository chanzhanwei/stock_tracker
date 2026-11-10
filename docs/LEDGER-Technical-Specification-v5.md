# LEDGER

**Institutional Signal Dashboard**
**Technical Specification — Version 5.0**

Supersedes `LEDGER-Technical-Specification-v4_Claude.docx`. v4 specified the single-file mockup. v5 records the application as it is actually packaged and deployed, locks the scoring rules to the code that ships, and specifies the production system that replaces the static feed.

| | |
|---|---|
| Status | Current build is a static front end. Sections marked **Built** describe `web/`. Sections marked **Target** are normative for the next build and are not implemented. |
| Audience | An engineer rebuilding or extending LEDGER with no prior conversation. |
| Source of truth for behavior | `web/src/signal-dashboard.jsx`. If this document and that file disagree, the file wins until the file is changed on purpose. |
| Not a trading system | Scores are unvalidated hypotheses. Nothing in this document authorizes automated orders or capital allocation. |

---

## 0. What changed from v4

v4 was accurate about product behavior and wrong about the runtime, because the mockup has since been wrapped and deployed.

**Built since v4**

- Vite + React application under `web/`, with Tailwind 4, Recharts, and lucide-react.
- Google Fonts load of Newsreader in `web/index.html` (v4 said the font was named in inline styles and not loaded).
- `deploy.sh` builds the bundle off the Windows mount and publishes a static site to nginx on port 8080.
- Page background and base font are set in `web/src/index.css`, not only inline.

**Unchanged from the v4 mockup**

- 22 hand-authored signals, 16 source kinds, 5 sectors.
- Conviction formula, source-lag table, confirmation multiplier, mechanical-flow weight, and historical-stat gate.
- Feed and Methodology are the only real pages. Watchlist, Filters, and the ticker search box are visual only.
- No API, database, auth, or live market data.

**Corrected relative to a naive reading of v4**

- `TXN_CODES[].counts` is display copy. Exclusion is a stored `excluded` flag. The scorer does not consult `TXN_CODES`.
- Conviction decay uses effective age. The chart, the freshness color, and the 15-day momentum split use calendar `daysAgo`.
- The trend line includes any real signal with `daysAgo >= 0`, including signals older than 30 days, on every point of the "trailing 30 days" chart. The 30-day label describes the x-axis, not a hard filter.
- Dollar-weighted flow and signal count do not apply decay, reputation, earnings boost, or confirmation. Only the conviction score does.
- A 13F or ETF event with the default 45-day lag has effective age ≥ 45, so its conviction contribution is always 0 under a 30-day decay window. It can still move the dollar and count metrics.

---

## 1. Product

LEDGER is a single-page dashboard of US ownership and flow signals. It shows insider and institutional filings (Form 4, Form 144, 13D, 13G, 13F, ETF holdings inside 13F) next to market-structure and corporate-event signals (options, short interest, securities lending, congressional disclosures, dark-pool prints, buybacks, convertibles, secondaries, index changes, corporate actions).

Those signals roll up by sector into three views of the same tape:

1. **Signal count** — each real buy is +1, each real sell is −1.
2. **Dollar-weighted net flow** — ownership change times market cap.
3. **Conviction score** — the same ownership change, scaled by filing type, reporting lag, filer reputation, earnings proximity, and cross-source confirmation.

The design constraint that must survive every later version: a same-day insider buy and a 45-day-old quarterly filing are not the same kind of information. Recency is a visible property of each card. Reporting lag is a separate property and affects the score, not the color of the spine.

### 1.1 Users

One operator, on a private LAN, reading the tape. There is no multi-tenant model, no sharing, and no customer account.

### 1.2 Success criteria

- A reader can tell, without opening Methodology, how old a card is, whether it was excluded, and whether another source agreed.
- Sector ranking changes when the metric toggle changes, on purpose.
- A rebuild from this document plus `signal-dashboard.jsx` reproduces the same 22 cards, the same conviction contributions, and the same chart shape.
- Before any live data is shown as a score, the weight table is versioned and a backtest harness exists (Section 12). Until then the UI must keep the "illustrative" disclaimer.

### 1.3 Non-goals

- Order entry, brokerage connectivity, portfolio accounting.
- Price prediction presented as a probability.
- Scraping paywalled vendors, bypassing access controls, or storing credentials in the repo.
- Mobile-native apps. The responsive web layout is the mobile surface.

---

## 2. System as built

### 2.1 Repository

```
LEDGER_institution_investor_tracker/
  LEDGER-Technical-Specification-v4_Claude.docx   # superseded
  LEDGER-Technical-Specification-v5.md            # this document
  signal-dashboard.jsx                            # original mockup; web/src is the running copy
  deploy.sh
  .env.deploy                                     # gitignored
  .ssh/                                           # gitignored
  web/
    index.html
    package.json
    vite.config.js
    src/main.jsx
    src/App.jsx
    src/index.css
    src/signal-dashboard.jsx
```

`web/node_modules/` and `web/dist/` are gitignored. `.env`, `*.pem`, and `*.ppk` are gitignored. Do not commit deploy keys.

### 2.2 Runtime stack

| Layer | Choice | Where |
|---|---|---|
| Bundler | Vite 8 | `web/vite.config.js` — `@vitejs/plugin-react` and `@tailwindcss/vite` |
| UI | React 19, function components, `useState` only | `web/src/signal-dashboard.jsx` |
| Styling | Tailwind CSS 4 utility classes plus inline hex | `web/src/index.css` imports Tailwind; colors are not in a theme file |
| Charts | Recharts 3 `LineChart` | `TrendChart` |
| Icons | lucide-react | imported at the top of the dashboard module |
| Fonts | Newsreader for headlines and card summaries; system sans for chrome; Tailwind `font-mono` for tickers, numbers, timestamps | Newsreader loaded in `index.html` |
| Data | In-memory `feed` array, 22 records | same module |
| Routing | None. `page` state is `'feed'` or `'info'` | `SignalDashboard` |
| Tests | None | — |
| Auth | None | — |

`App.jsx` only renders `<SignalDashboard />`. `main.jsx` mounts it in `#root` under `StrictMode`. StrictMode double-invokes render in development; every calculation is pure, so that is safe.

### 2.3 Process and deploy — Built

`deploy.sh` is the release path.

1. Read `DEPLOY_SERVER` and `DEPLOY_USER` from `.env.deploy`.
2. Use `DEPLOY_SSH_KEY`, or copy `.ssh/vast_comfyui` to `~/.ssh/ledger_deploy_key` and `chmod 600` it. The copy exists because keys on the Windows mount do not keep Unix modes.
3. Rsync `web/` to a temp directory, excluding `node_modules` and `dist`, so `npm` does not run on the NTFS mount.
4. `npm install` and `npm run build` in that temp directory.
5. `scp` the `dist/` contents to `~/ledger-deploy/` on the host.
6. On the host, replace `/var/www/ledger/`, `chown` to `www-data`, `nginx -t`, reload nginx.
7. Probe `http://127.0.0.1:8080/` from the host.

The site is static files. Nginx serves them on port **8080**. Port 80 on the same host is a different site and must not be overwritten. There is no process manager for LEDGER because there is no server process.

Local development: `cd web && npm install && npm run dev`.

### 2.4 What the operator can do today

| Control | Behavior |
|---|---|
| Logo | Sets `page` to `feed` |
| Feed | Feed page |
| Watchlist | Sets `page` to `feed`. No watchlist exists |
| Filters | Sets `page` to `feed`. No filters exist |
| Methodology | Opens `InfoPage` on the last info tab, default `points` |
| Market open pill | Always green. Not tied to a clock or exchange calendar |
| Metric toggle | `weighted` (default), `count`, or `dollar`. Drives both the sector totals and the chart |
| How this is calculated | Opens Methodology on `points` |
| How buy/sell signals are determined | Opens Methodology on `signals` |
| Sources info | Opens Methodology on `sources` |
| Ticker or fund input | Uncontrolled. No `value`, no `onChange`, no filter |
| Card source link | Icon only. No URL |
| Close on Methodology | Returns to the feed |

Desktop (`md`, 768px): two columns, sources in a 280px aside. Below that: one column, sources under the feed, hamburger nav.

---

## 3. Information architecture — Built

```
Header
├── Feed
│   ├── Industry summary
│   │   ├── metric toggle
│   │   ├── sector legend
│   │   ├── cumulative step chart
│   │   └── sector rows (total + momentum vs prior 15d)
│   ├── Recency spine
│   │   ├── freshness legend
│   │   └── cards, feed order (not re-sorted)
│   └── Sources panel
└── Methodology
    ├── Point calculation
    ├── Buy/sell rules
    ├── Data sources (includes the lag table)
    └── Backtest & accuracy
```

The feed array is the display order. It is roughly recency-ordered but is not sorted at runtime. A production feed must sort by event time descending before render.

---

## 4. Visual system — Built

Ink-ledger. Dark, editorial, dense. Freshness has its own colors. Confirmation and mechanical-flow badges stay dim so they do not compete with the spine.

### 4.1 Palette

| Token | Hex | Use |
|---|---|---|
| Background | `#0B0F14` | Page. Also set on `html, body, #root` |
| Surface | `#131920` | Cards, panels, methodology cards |
| Hairline | `#1F2830` | Borders, chart grid, card footers |
| Text primary | `#E8E6DF` | Tickers, headlines |
| Text muted | `#9AA0A8` | Body |
| Text dim | `#6B7280`, `#5B6169`, `#454C55` | Meta, timestamps, stale |
| Brand | `#C9A24B` | Logo dot, section eyebrows, earnings badge |

### 4.2 Freshness

`freshnessTier(daysAgo)` uses **calendar** age.

| Tier | Label | Calendar age | Color | Card |
|---|---|---|---|---|
| 1 | Live | 0–1 day | `#4C9A6A`, glow | full opacity |
| 2 | Recent | 2–7 days | `#D9A441` | full opacity |
| 3 | Aging | 8–30 days | `#5E8FB0` | full opacity |
| 4 | Stale | 31+ days | `#454C55` | opacity 0.6 |

Excluded cards: dashed border, opacity 0.55, grey dot, no glow. The exclusion style wins over freshness glow.

`lagLabel`: `Today`, `Yesterday`, `{n}d ago` through 30, else `{n}d old`. If `SOURCE_LAG_DEFAULTS[kind] > 0`, append ` (+{lag}d lag)` in `#5B6169`.

### 4.3 Badges

| Tone | Background | Text | Use |
|---|---|---|---|
| default | `#1F2830` | `#8A8F98` | Core kinds: Form 4, 13D, 13G, 13F |
| warn | `#2A1F17` | `#C9A24B` | Every other kind |
| mute | `#161B21` | `#5B6169` | Reputation, "Mechanical flow" |
| confirm | `#241E10` | `#D9A441` | Defined, not used. Confirmation is an inline `Link2` row, not a `Badge` |

### 4.4 Direction and sector lines

| Action | Color | Icon |
|---|---|---|
| buy | `#4C9A6A` | TrendingUp |
| sell | `#B4543A` | TrendingDown |
| flat | `#6B7280` | Circle |

| Sector | Line |
|---|---|
| Technology | `#C9A24B` |
| Industrials | `#4C9A6A` |
| Healthcare | `#5E8FB0` |
| Consumer | `#B4543A` |
| Financials | `#8E7FC9` |

Unknown sector falls back to `#8A8F98`.

Chart: height 220, `type="stepAfter"`, no dots, horizontal grid only, tooltip background `#0B0F14`.

---

## 5. Domain model

### 5.1 Signal — Built

One element of `feed`.

| Field | Type | Required | Role |
|---|---|---|---|
| `id` | number | yes | React key. Unique |
| `kind` | enum, Section 6 | yes | Filing weight, lag, badge tone, mechanical flag |
| `txnCode` | `P\|S\|A\|M\|F\|G\|null` | Form 4 only | Badge suffix. Not read by the scorer |
| `daysAgo` | number ≥ 0 | yes | Freshness, chart, confirmation window, momentum split |
| `ticker` | string | yes | Display and confirmation grouping |
| `sector` | one of the five sector names | yes | Roll-up key |
| `holder` | string | yes | Display |
| `action` | `buy\|sell\|flat` | yes | Sign of count; `flat` drops out of every metric |
| `from`, `to` | number | yes | `deltaPct = to - from`. Meaning depends on kind (5.2) |
| `marketCapB` | number | yes | Dollar metric, billions of USD |
| `filerType` | reputation key or omitted | no | Reputation weight, unless the kind is mechanical |
| `daysToEarnings` | number or null | no | ×1.25 when set, ≤ 10, and the kind is not mechanical |
| `relativeSize` | string | no | Display |
| `priceConfirmation` | string | no | Display |
| `customSummary` | string | no | Replaces the generated summary |
| `excluded` | boolean | no | Drops the row from every metric |
| `excludeReason` | string | when excluded | Shown with a ban icon |
| `historicalStats` | object | no | `{ sampleSize, winRate, avgExcessReturn60d, lastUpdated }` |
| `time` | string | yes | Footer, display only |
| `source` | string | yes | Footer citation, display only |

There is no `filingId`, `institutionId`, `occurredAt`, `visibleAt`, `sourceUrl`, or `modelVersion` in the built feed. Those are required in the target model (5.3).

### 5.2 What `from` / `to` mean

`deltaPct = to - from` is always "percentage points," but the percentage is not always ownership.

| Kind | `from` → `to` |
|---|---|
| FORM 4, 13D, 13G, 13F | Ownership percent |
| OPTIONS | Open-interest concentration percent |
| SHORT INT | Short interest as percent of float |
| CONGRESS | Trade size as percent of the filer's portfolio |
| DARK POOL | Print size as percent of 20-day average volume. `from` may be 0 |
| FORM 144 | Planned sale as percent of the insider's holdings |
| BUYBACK | Authorization as percent of market cap |
| CONVERTIBLE | Potential dilution as percent of shares outstanding |
| SECLEND | Borrow utilization percent |
| INDEX | Forced buying as percent of float |
| SECONDARY | New shares as percent of shares outstanding |
| CORPORATE_ACTION | Expected mechanical selling as percent of float |
| ETF | Position as percent of the fund's disclosed 13F assets |

The dollar metric multiplies `deltaPct / 100` by `marketCapB` for every kind. That is coherent for ownership and dilution. It is a rough proxy for options concentration, portfolio-percent congressional trades, utilization, and ETF-asset percent. The target dollar metric (Section 8.3) must stop using market cap for kinds whose unit is not shares of the issuer.

### 5.3 Signal — Target

```
Signal
  id                  uuid
  modelVersion        string          # weight table that scored it
  kind                Kind
  txnCode             TxnCode | null
  ticker              string          # canonical, e.g. BRK.B not BRK-B
  sector              Sector
  holderId            uuid | null
  holderLabel         string
  action              buy | sell | flat
  fromValue           number
  toValue             number
  unit                ownership_pct | oi_concentration_pct | short_float_pct
                    | portfolio_pct | adv_pct | holdings_pct | market_cap_pct
                    | dilution_pct | utilization_pct | float_pct | fund_assets_pct
  marketCapUsd        number | null
  dollarFlowUsd       number | null   # precomputed only when unit supports it
  filerType           FilerType | null
  mechanical          boolean
  occurredAt          timestamptz     # event time
  visibleAt           timestamptz     # when a live system could have seen it
  sourceLagDays       number          # default from kind, overridable per row
  daysToEarnings      number | null   # as of visibleAt
  excluded            boolean
  excludeReason       string | null
  summary             string
  relativeSize        string | null
  priceConfirmation   string | null
  historicalStats     HistoricalStats | null
  sourceName          string
  sourceUrl           string | null
  externalId          string          # vendor or accession number; unique with kind
```

`daysAgo` is derived: whole calendar days from `occurredAt` to the scoring clock, in America/New_York. Do not store it.

Confirmation and decay in production use `visibleAt`, not a reconstructed `daysAgo`, so a backtest can ask "what was knowable on date D" without lookahead.

### 5.4 Reference tables — Built, and still the default weight set

Weights are hypotheses. Version them as `modelVersion = "v4-hypothesis"` until a backtest promotes a new table.

**Filing weights**

| Kind | Weight |
|---|---|
| 13D | 3.0 |
| FORM 4 | 2.0 |
| BUYBACK | 1.6 |
| 13G | 1.5 |
| CONGRESS | 1.4 |
| SECONDARY | 1.4 |
| FORM 144 | 1.3 |
| INDEX | 1.3 |
| SHORT INT | 1.2 |
| CONVERTIBLE | 1.2 |
| CORPORATE_ACTION | 1.2 |
| DARK POOL | 1.1 |
| SECLEND | 1.1 |
| 13F | 1.0 |
| OPTIONS | 1.0 |
| ETF | 1.0 |

Unknown kind: weight 1.

**Source lag, days.** Added to calendar age for decay only.

| Kind | Scoring lag | Note |
|---|---|---|
| OPTIONS, DARK POOL, INDEX | 0 | Same-day |
| FORM 4, FORM 144, BUYBACK, SECLEND, SECONDARY, CORPORATE_ACTION | 1 | |
| 13D, 13G, CONVERTIBLE | 2 | |
| SHORT INT | 10 | FINRA is bi-monthly; 10 is a typical midpoint, not the schedule |
| CONGRESS | 30 | Typical. Legal maximum under the STOCK Act is 45. The Methodology page must keep both numbers |
| 13F, ETF | 45 | Quarter-end plus the statutory filing window |

**Reputation**

| `filerType` | Label | Weight |
|---|---|---|
| activist | Known activist | 1.5 |
| insider-cluster | Insider cluster | 1.3 |
| insider | Single insider | 1.0 |
| passive-index | Passive index fund | 0.6 |
| scheduled-plan | 10b5-1 scheduled sale | 0.5 |
| omitted | — | 1.0 |

**Mechanical kinds:** `INDEX`, `CORPORATE_ACTION`. Fixed reputation `0.7`. Earnings boost forced to 1. A `filerType` on those rows is ignored.

**Other constants**

| Name | Value |
|---|---|
| `DECAY_WINDOW_DAYS` | 30 |
| `CONFIRMATION_WINDOW_DAYS` | 7 |
| `CONFIRMATION_STEP` | 0.25 |
| `CONFIRMATION_CAP` | 2.0 |
| `MIN_HISTORY_SAMPLE` | 5 |
| Earnings window | 10 calendar days |
| Earnings boost | 1.25 |
| Momentum "recent" | calendar `daysAgo <= 15` |
| Momentum "older" | `15 < daysAgo <= 30` |

**Form 4 codes** (labels only, until ingestion enforces them)

| Code | Label | Counts as a market decision |
|---|---|---|
| P | Open-market purchase | yes |
| S | Open-market sale | yes |
| A | Stock award / RSU vest | no |
| M | Option exercise | no |
| F | Tax withholding | no |
| G | Gift | no |

10b5-1 sales stay in the feed with `filerType = scheduled-plan` (weight 0.5). They are not excluded.

---

## 6. Source catalog

Sixteen kinds. Core kinds use the default badge. All others use the warn badge.

| Kind | Actor | Direction rule | Built example |
|---|---|---|---|
| FORM 4 | Insider | P buy, S sell. A/M/F/G excluded upstream | NVDA cluster buy; SHOP 10b5-1 sale; TSLA RSU excluded |
| FORM 144 | Insider | Planned sale is a sell, weighted below a filed Form 4 | NFLX director |
| 13D | Activist | Stake up = buy, stake down = sell | Engine Capital / ACME, Starboard / KSS |
| 13G | Passive institution | Same, lower weight | Vanguard / DUOL, BlackRock / CAT, State Street / JPM |
| 13F | Institution, quarterly | New or increased = buy, reduced or closed = sell, unchanged = flat | Berkshire / BRK.A is flat and therefore unscored |
| ETF | Institution via ETF | Same comparison, read as sector conviction | Pension / XLK |
| OPTIONS | Anonymous flow | Call-heavy unusual flow = buy. Noisy; hedging is common | NVDA call sweep |
| SHORT INT | Aggregate shorts | Falling short interest = buy (cover); rising = sell | DE cover |
| SECLEND | Borrow market | Rising utilization = sell (crowding). Not the same as a discretionary short | GME |
| CONGRESS | Member | Disclosed buy or sell | GS |
| DARK POOL | Unknown block | Direction is inferred, not observed. Single prints stay weak until confirmed | TGT |
| BUYBACK | Issuer | Authorization = buy, and it shrinks float | HD |
| SECONDARY | Issuer | New shares = sell (supply) | CHPT |
| CONVERTIBLE | Issuer | Potential dilution = sell. Card copy must say convert-arb shorts are mechanical | MRNA |
| INDEX | Index funds | Forced buy or sell | V addition |
| CORPORATE_ACTION | Mandate holders | Forced flow, usually sell after a spin | GE |

### 6.1 Materiality — Target

The mockup assumes noisy rows were removed before they reached `feed`. Production ingestion must apply gates **before** insert. Starting gates, all hypotheses:

| Kind | Keep the row when |
|---|---|
| FORM 4 | Code is P or S, and notional ≥ $50,000, or the same ticker has ≥ 2 insiders on P or S inside 5 calendar days (then `filerType = insider-cluster`) |
| FORM 144 | Planned sale ≥ $100,000 |
| 13D | Initial filing, or \|Δ ownership\| ≥ 0.5 percentage points |
| 13G | \|Δ ownership\| ≥ 0.5 percentage points |
| 13F | New, closed, \|Δ shares\| ≥ 25%, or \|dollar change\| ≥ $25,000,000 |
| ETF | Same as 13F, and the holding is an ETF |
| OPTIONS | Unusual sweep or \|Δ OI concentration\| ≥ 2 points. Vendor-specific; document the vendor rule next to the row |
| SHORT INT | \|Δ short % of float\| ≥ 0.5, or \|Δ\| ≥ 20% of the prior reading |
| SECLEND | Utilization crosses 80%, or borrow fee doubles |
| CONGRESS | Any disclosed transaction ≥ $15,001 (the STOCK Act band). Store the band, not a fake precise percent, until a vendor provides one |
| DARK POOL | Print ≥ 5% of 20-day average volume |
| BUYBACK | New authorization ≥ 1% of shares outstanding or ≥ $100,000,000 |
| SECONDARY / CONVERTIBLE | Deal ≥ 2% of shares outstanding, or ≥ $50,000,000 |
| INDEX | Announced add or delete for a tracked index (S&P, Russell, MSCI) |
| CORPORATE_ACTION | Spin-off, merger election, or other event expected to force ≥ 2% of float |

Rows that fail the gate are stored in an audit table and are not sent to the feed API.

### 6.2 Providers — Target

| Provider | Kinds | Access |
|---|---|---|
| SEC EDGAR | FORM 4, FORM 144, 13D, 13G, 13F, BUYBACK (8-K), SECONDARY, CONVERTIBLE | Public submissions API and filing index. Identify by accession number |
| Cboe or a licensed options vendor | OPTIONS | Licensed |
| FINRA | SHORT INT, DARK POOL (ADF / OTC transparency) | Public files |
| Securities-lending vendor | SECLEND | Licensed. Name the vendor on the card |
| Capitol Trades or Quiver | CONGRESS | Their terms of use. Do not scrape past a prohibition |
| Index providers | INDEX | Press and index-change calendars |
| Nasdaq or Zacks | earnings dates | Licensed or public calendar |
| Market-data vendor | market cap, price, ADV | Required for dollar flow and `priceConfirmation` |
| Activist dataset | `filerType = activist` | Licensed or a hand-maintained list with a cited source |
| WhaleWisdom, Dataroma, Fintel, OpenInsider | optional cross-checks | Aggregators. EDGAR remains the system of record for filings |

Every stored signal keeps `sourceName`, `sourceUrl` or accession, and `visibleAt`. The card footer links to `sourceUrl`.

---

## 7. Scoring — normative

These functions match the built file. Production code should extract them into a pure module with fixture tests (Section 12.1) before any live feed calls them.

### 7.1 Validity

```
isRealSignal(item):
  if item.excluded: return false
  if item.action == "flat": return false
  return true
```

### 7.2 Age

```
sourceLagFor(item)     = SOURCE_LAG_DEFAULTS[item.kind] ?? 0
effectiveDaysAgo(item) = item.daysAgo + sourceLagFor(item)
freshnessTier(item)    = tier(item.daysAgo)          # calendar, not effective
```

Target equivalent, given a clock `now`:

```
calendarDays = floor((now - occurredAt) in America/New_York)
lagDays      = item.sourceLagDays
effectiveDays = floor((now - visibleAt) in America/New_York)
```

`visibleAt` should already include the lag (`visibleAt = occurredAt + lag`). Decay uses `effectiveDays`. The spine uses `calendarDays`.

### 7.3 Confirmation

For item `i`, among other real signals with the same `ticker` and `abs(other.daysAgo - i.daysAgo) <= 7`:

```
count      = number of distinct other.kind
multiplier = min(1 + 0.25 * count, 2.0)
```

Self is not counted. Two Form 4s do not confirm each other. A Form 4 plus an OPTIONS row does.

Built behavior compares calendar `daysAgo` because the mock has no timestamps. Target behavior compares `visibleAt` within 7 days. Direction does not have to match. That is a known weakness: a confirming sell boosts a buy. Target v2 of the formula should split confirming-with vs confirming-against. Do not change it silently.

The card shows the row only when `count > 0`: `{count} confirming source(s) (×{multiplier to 2 decimals})`.

Worked example in the fixture set: NVDA Form 4 (`id` 1, day 0) and NVDA OPTIONS (`id` 11, day 0) confirm each other. Each has count 1 and multiplier 1.25.

### 7.4 Contribution

```
deltaPct = to - from

count:  buy → +1, sell → −1, else 0
        # no decay, no weights

dollar: (deltaPct / 100) * marketCapB
        # billions of USD; no decay, no weights
        # sign comes from deltaPct, which follows action in the fixture set
        # but the formula does not read `action`

weighted:
  filingW       = FILING_WEIGHTS[kind] ?? 1
  mechanical    = kind in {INDEX, CORPORATE_ACTION}
  decay         = max(0, 1 - effectiveDaysAgo / 30)
  rep           = 0.7 if mechanical else (REPUTATION[filerType].weight ?? 1)
  earningsBoost = 1.25 if (not mechanical and daysToEarnings != null and daysToEarnings <= 10) else 1
  confMult      = confirmationFor(item).multiplier
  score         = deltaPct * filingW * decay * rep * earningsBoost * confMult
```

A negative `deltaPct` on a buy, or a positive `deltaPct` on a sell, would disagree with the count metric. Ingestion must set `action` from the sign of `deltaPct` (`> 0` buy, `< 0` sell, `= 0` flat) except where a kind documents the opposite mapping (short interest down is a buy). For SHORT INT and any future inverse kind, store `deltaPct` already signed in the signal direction, and record the raw readings alongside.

Decay hits zero at effective age 30 and stays zero after that. Consequences to preserve and to explain in Methodology:

- A 13F or ETF row scores 0 on conviction at every calendar age, because lag is 45.
- Congress at calendar age 0 has effective age 30 and scores 0.
- Dollar and count still include those rows.

### 7.5 Sector roll-up

For each sector, over items in that sector:

```
total    = sum(contribution(item, metric))          # no age cutoff
recent   = sum(contribution where daysAgo <= 15)
older    = sum(contribution where 15 < daysAgo <= 30)
momentum = recent - older
buys     = count of real buys
sells    = count of real sells
```

Sort sectors by `total` descending. `buys` and `sells` are computed and not rendered.

Momentum uses calendar age and the already-weighted contribution. A green arrow means `momentum >= 0`. The label is always "vs prior 15d".

Format:

| Metric | Format |
|---|---|
| count | signed integer, `+` prefix when positive |
| dollar | signed, 2 decimals, suffix `B` |
| weighted | signed, 1 decimal |

### 7.6 Trend line

For `d` from 0 to 30:

```
threshold = 30 - d
point[sector] = round(sum(contribution of items in sector with daysAgo >= threshold), 2)
label = "Today" if d == 30 else "{30 - d}d"
```

This is a cumulative build through time, oldest included first. It is not a daily delta. Items with `daysAgo > 30` are inside every point, including the left edge.

### 7.7 Historical stats

If `historicalStats` is absent, show nothing.

If `sampleSize >= 5`, show:

`History: net {buyer|seller} on {round(winRate * sampleSize)}/{sampleSize} similar signals, avg {signed avgExcessReturn60d}% 60d`

`winRate >= 0.5` selects the word "buyer". That word is about the hit rate, not about whether this card is a buy.

If `sampleSize < 5`, show a dim line: `History: insufficient sample (n={sampleSize}) — hidden below n=5`. Do not omit the line. The JPM / State Street row (`sampleSize` 3) is the fixture for this branch.

Copy must stay descriptive. Do not render "probability", "expected return", or "edge".

### 7.8 Summary line

`customSummary` if present. Else if `action` is flat: `{holder} holds position unchanged`. Else `{holder} increases|reduces stake from {from}% to {to}%`.

---

## 8. Target architecture

The built app stays the client. Live data is added behind it. The client must not embed vendor keys.

```
EDGAR / FINRA / licensed vendors
        │
        ▼
Ingestion workers (one per source, idempotent on kind + externalId)
        │
        ▼
Postgres
  raw_events  →  signals  →  scores (modelVersion)
        │
        ▼
Read API (JSON)
        │
        ▼
Vite SPA (this UI)         Scoring module (shared with the backtest job)
```

### 8.1 Services

| Service | Responsibility |
|---|---|
| `ledger-web` | The existing SPA. Fetches JSON. Falls back to the fixture feed only in development |
| `ledger-api` | Read models for the feed, sector roll-up, and one signal |
| `ledger-ingest` | Poll or subscribe, normalize, apply materiality, set `visibleAt` |
| `ledger-score` | Pure function of `(signals, modelVersion, asOf) → contributions`. Used by the API and by backtests |
| `ledger-backtest` | Offline. Point-in-time signals joined to forward returns. Writes a report. Does not serve the UI |

One language for `ledger-score` so the UI disclaimer and the API cannot drift. Preferred: TypeScript module imported by the API and by a batch script. The React file calls that module; it does not reimplement the formula.

### 8.2 Storage

Postgres. Minimum tables:

- `securities(ticker pk, name, sector, cik)`
- `holders(id, name, cik, filer_type, reputation_source)`
- `raw_events(id, kind, external_id, payload jsonb, fetched_at)` unique `(kind, external_id)`
- `signals` as in Section 5.3, unique `(kind, external_id)`
- `model_weights(version pk, weights jsonb, created_at, note)`
- `signal_scores(signal_id, model_version, as_of date, contribution_weighted, decay, confirmation_multiplier)`
- `ingest_runs(source, started_at, finished_at, accepted, rejected, error)`

Float history, when built: `share_counts(ticker, as_of date, shares_outstanding, source)`.

No Redis until a profile says the API needs it. The working set is thousands of rows, not millions, for a personal universe.

### 8.3 API

JSON, no auth on the LAN host in v1 of the API. Bind to localhost or the LAN, not the public internet. If the host is ever exposed, put HTTP basic auth or a private VPN in front. Do not invent a user system for one operator.

```
GET /api/health

GET /api/feed?asOf=ISO-8601&sector=&kind=&ticker=&limit=200
  → { modelVersion, asOf, signals: Signal[] }     # already scored fields included

GET /api/sectors?metric=weighted|count|dollar&asOf=ISO-8601
  → { modelVersion, asOf, rows: SectorRow[], series: ChartPoint[] }

GET /api/signals/:id
  → Signal plus raw source citation

GET /api/methodology
  → the active weight tables, so the Methodology page renders server constants
```

Errors: `{ error: string }` with 400 for bad query, 404 for unknown id, 503 when a required ingest is stale (see 8.5).

The feed response is sorted by `occurredAt` descending. Excluded rows are included, flagged, so the spine can still show them.

### 8.4 Dollar metric — Target correction

Compute `dollarFlowUsd` only when `unit` is `ownership_pct`, `dilution_pct`, `market_cap_pct`, or `float_pct`:

```
dollarFlowUsd = (toValue - fromValue) / 100 * marketCapUsd
```

For `short_float_pct`, express the cover or the new short in dollars of the underlying, and tag it as short flow so it is not added to ownership flow without a label.

For `portfolio_pct`, `adv_pct`, `oi_concentration_pct`, `utilization_pct`, and `fund_assets_pct`, leave `dollarFlowUsd` null. Those rows count in the conviction and count metrics only. The sector dollar total must not pretend an options concentration change is a market-cap-weighted ownership change.

### 8.5 Freshness of the pipe

Each ingest run records success time. The API sets `stale: true` on a source when `now - last_success` exceeds:

| Source | Stale after |
|---|---|
| EDGAR current filings | 6 hours on a business day |
| Options, dark pool | 1 trading day |
| Securities lending | 2 trading days |
| FINRA short interest | 20 calendar days (the file is bi-monthly) |
| 13F | 100 calendar days |
| Congress | 50 calendar days |

The header pill replaces the fake "Market open" indicator with the worst stale state: green when every enabled source is inside its window, amber when any is stale, and a list of which ones in the sources panel.

---

## 9. Frontend target deltas

Keep the visual system. Change behavior only as follows.

| Surface | Change |
|---|---|
| Data | Load `/api/feed` and `/api/sectors`. Show the fixture feed only when `import.meta.env.DEV` and the API is absent |
| Search | Filters the spine by ticker or holder substring, case-insensitive. Does not change sector totals unless a "filter the roll-up" control is on. Default: filter cards only |
| Filters page | Kind, sector, action, excluded toggle, mechanical toggle, minimum conviction. Query params, shareable |
| Watchlist | Local list of tickers in `localStorage` key `ledger.watchlist`. A third `page` value. Empty state explains how to add |
| Market pill | Driven by `stale` from the API, not a constant |
| Card source | `<a href={sourceUrl} target="_blank" rel="noreferrer">` |
| Methodology constants | Read from `/api/methodology` so a weight change does not require a UI edit |
| Chart caption | State the metric, the as-of time, and the model version |

Watchlist and filters stay client-side until there is a reason to store them on the server. One operator does not need accounts.

### 9.1 Component map — Built

| Component | State | Notes |
|---|---|---|
| `SignalDashboard` | `navOpen`, `page`, `infoTab` | Shell |
| `IndustrySummary` | `activeMetric` | Default `weighted` |
| `TrendChart` | none | Calls `useTimeSeries`, which is a plain function |
| `Card` | none | |
| `SourcesPanel` | none | Static string list |
| `InfoPage` | `tab` | Seeded from `initialTab` once. Later `openInfo` does not update an already-mounted page, because `initialTab` is only the `useState` initial value. Navigating Feed → Methodology via two different info buttons in one session can show the first tab. Target: key `InfoPage` on `infoTab` (`key={infoTab}`) or lift tab state |
| `Badge`, `Legend`, `InfoCard` | none | |

`useIndustrySummary` and `useTimeSeries` are not hooks. They do not memoize. That is fine at 22 rows. At production size, memoize on `(signals, metric, asOf, modelVersion)`.

---

## 10. Ingestion — Target

One worker per source. Shared contract:

1. Fetch new records since the last watermark.
2. Upsert `raw_events` on `(kind, externalId)`.
3. Normalize to a signal. Set `occurredAt` from the filing event date and `visibleAt` from the acceptance time plus any extra lag the source needs.
4. Apply Section 6.1. Rejected rows stay in `raw_events` with a reason.
5. Resolve `sector` from `securities`. Unknown ticker: sector `Unclassified`, and do not drop the row.
6. Write `ingest_runs`.
7. Never delete a signal that was once visible. Corrections are new versions or an `excluded` update with a reason.

EDGAR first. It is public, it covers the core kinds, and it is enough to replace most of the fixture file. Alt-data vendors come after the scoring fixtures pass on real Form 4 / 13D / 13F rows.

Cluster detection for Form 4 runs after the day's filings are in: group P and S by ticker and calendar week; if two or more distinct reporting owners bought, set `filerType = insider-cluster` on those buys.

Float adjustment is a separate job, not part of v1 ingestion. Until `share_counts` exists, the Methodology "known gap" card stays on screen.

---

## 11. Deployment — Target

Keep the static publish in `deploy.sh` for the SPA.

Add a second unit on the same host for the API and workers, only when they exist:

- API listens on `127.0.0.1:8081`.
- Nginx on 8080 continues to serve `/var/www/ledger` and proxies `/api/` to 8081.
- Postgres on localhost, not exposed.
- Secrets in a root-owned env file on the host, mode 600, not in git. The SPA bundle must not contain them.
- Ingest timers via systemd, not cron hidden in a home directory. One timer per source. Journald holds logs.
- Backups: nightly `pg_dump` of `signals`, `raw_events`, and `model_weights`, retained 30 days on the host.

Build remains reproducible from `web/` plus the lockfile. The rsync-to-tmp step stays, because this repo lives on a Windows drive mounted into WSL.

---

## 12. Verification

### 12.1 Scoring fixtures — required before live data

Extract the formula and assert at least:

| Case | Expect |
|---|---|
| TSLA Form 4 `excluded` | contribution 0 on all three metrics |
| BRK.A 13F `flat` | contribution 0 |
| NVDA Form 4 and NVDA OPTIONS | each confirmation multiplier 1.25 |
| JPM historical stats | hidden branch, `sampleSize` 3 |
| INDEX row | reputation 0.7, earnings boost 1, mechanical badge |
| Calendar age 0, kind 13F | decay 0, conviction 0, dollar still `(Δ% / 100) * marketCapB` |
| `daysToEarnings` 6, non-mechanical | earnings factor 1.25 |
| `daysToEarnings` 6, INDEX | earnings factor 1 |
| Two signals, same kind, same ticker, 3 days apart | confirmation count 0 |
| Signal at `daysAgo` 31 | freshness tier 4; included in every chart point |

Also snapshot the five sector totals for `weighted`, `count`, and `dollar` against the current 22-row fixture. A future edit that moves a number must update the snapshot in the same change.

### 12.2 UI checks

On a desktop width and a 390px width:

- Feed loads, chart has five lines, metric toggle changes the sector figures.
- Methodology opens on all four tabs, lag table lists 16 kinds, close returns to the feed.
- Excluded TSLA card is dashed and says why.
- NVDA cards show one confirming source.
- JPM shows the insufficient-sample line.
- INDEX and CORPORATE_ACTION show "Mechanical flow".

### 12.3 Backtest — required before any weight is treated as real

Offline, no UI dependency.

- Universe: 2–3 years of the same kinds.
- Timestamp each signal at `visibleAt`. Features may not use any field that was unknown then.
- Forward total return and sector-relative return at 30, 60, and 90 trading days.
- Report by conviction decile and by kind: hit rate, average excess return, false-positive rate.
- Ablations: confirmation multiplier off, mechanical weight off, decay off. Keep an ablation only if it improves out-of-sample sector-relative return without raising drawdown on the short side of the signal.
- Compare to buy-and-hold of the sector, not only to other tiers.
- Write `modelVersion`, date range, and the weight JSON into the report header.

Until that report exists, the Backtest tab keeps the amber "not yet run" status. Do not delete that card when wiring live data.

---

## 13. Security and privacy

- Deploy keys and `.env.deploy` stay gitignored.
- The published site is on a LAN port. Do not port-forward 8080 to the internet as part of this spec.
- Vendor API keys live only on the host env file.
- Congressional and insider records are public filings. Still store the minimum needed to render the card and reproduce the score. Do not add contact data, account numbers, or non-public personal data.
- External links use `rel="noreferrer"`.
- Raw vendor payloads may contain fields the UI does not need. Keep them in `raw_events` for audit, and do not send `payload` to the client.

---

## 14. Delivery phases

| Phase | Outcome | Done when |
|---|---|---|
| 0 — current | Static SPA on nginx :8080, fixture feed | Shipped |
| 1 — score module | Formula extracted, fixture tests green, UI calls the module | Snapshot totals match today's dashboard |
| 2 — EDGAR | Form 4, 13D, 13G, 13F, Form 144 in Postgres; feed API; UI reads it; fixture still available in dev | A card links to its EDGAR filing; excluded A/M/F/G never appear as scored |
| 3 — market data | Live market cap and a one-line price confirmation | Dollar metric uses `marketCapUsd`; non-ownership kinds no longer pretend to be dollar ownership |
| 4 — navigation | Working search, filters, watchlist; `InfoPage` tab bug fixed; stale-source pill | The three controls do what their labels say |
| 5 — alt data | Options, short interest, lending, congress, dark pool, corporate events, behind the same signal contract | Each kind has a documented materiality rule and a named source |
| 6 — honesty layer | Float history, related-activity expander (`holderId` + prior signals), confirmation split into agreeing vs opposing | Known-gap card can be removed only after float adjustment is on |
| 7 — evidence | Backtest report for the active `modelVersion` | Weights stay labeled hypothesis until this report is attached |

Phase 6 includes the institution flow map (net dollars between sectors or holders) only after dollar flow is limited to units that are actually dollars. A Sankey of proxy percentages would repeat the Section 8.3 bug at larger scale.

---

## 15. Rebuild checklist

**To reproduce what is running**

1. Scaffold Vite React in `web/` with the Tailwind Vite plugin.
2. Load Newsreader in `index.html`. Set the page background in `index.css`.
3. Copy `signal-dashboard.jsx` to `web/src/` and render it from `App.jsx`.
4. Confirm the constants in Section 5.4 match the file.
5. Confirm Section 7 against the file, including the chart's `daysAgo >= threshold` rule and the fact that dollar and count ignore weights.
6. `npm run build`. Publish with `deploy.sh` without disturbing the host's port-80 site.

**To leave the mockup**

7. Extract Section 7 into a pure module and add the Section 12.1 fixtures.
8. Add Postgres and the EDGAR worker before any other vendor.
9. Serve `/api/feed` and point the spine at it.
10. Do not remove excluded-card styling, the lag suffix, the mechanical badge, the confirmation row, or the sample-size gate.
11. Do not run capital off the score until Section 12.3 has a report and a person has read it.

---

## 16. Open decisions

These are unspecified on purpose. Do not invent a default in code without writing it down here.

| Decision | Why it is open |
|---|---|
| Options vendor | License and redistribution terms differ. Card source string must name whoever is chosen |
| Securities-lending vendor | Same |
| Universe | All SEC filers, or a watchlist of names. Ingestion cost and card volume depend on this |
| Sector taxonomy | GICS vs a five-bucket map. The UI currently has five buckets |
| Confirmation across directions | Today's formula treats any second kind as support. Section 7.3 says to split this later, with a backtest |
| Where 13F conviction should be non-zero | A 30-day decay and a 45-day lag cannot both be literal if 13F is supposed to affect the conviction score. Either lengthen decay for lagged kinds, or show 13F only in count and dollar. Pick one with the backtest, not by tweaking the constant |

---

## Appendix A. Fixture index

The built feed has 22 rows. Ids are stable.

| id | Kind | Ticker | Why it is in the fixture |
|---|---|---|---|
| 1 | FORM 4 P | NVDA | Cluster buy, earnings in 6 days, history shown, confirms id 11 |
| 2 | FORM 4 S | SHOP | 10b5-1 scheduled sale |
| 3 | 13D | ACME | Activist, history shown |
| 4 | 13G | DUOL | Passive buy |
| 5 | FORM 4 A | TSLA | Excluded RSU vest |
| 6 | 13G | CAT | Passive sell |
| 7 | FORM 4 P | ELV | Single insider, earnings in 4 days |
| 8 | 13D | KSS | Activist, price not confirmed |
| 9 | 13G | JPM | History hidden, n=3 |
| 10 | 13F | BRK.A | Flat, unscored, stale calendar age |
| 11 | OPTIONS | NVDA | Confirms id 1 |
| 12 | SHORT INT | DE | Cover |
| 13 | CONGRESS | GS | STOCK Act |
| 14 | DARK POOL | TGT | Direction inferred |
| 15 | FORM 144 | NFLX | Intent, not an execution |
| 16 | BUYBACK | HD | Issuer bid |
| 17 | CONVERTIBLE | MRNA | Dilution plus convert-arb caveat in the summary |
| 18 | SECLEND | GME | Utilization spike |
| 19 | INDEX | V | Mechanical buy |
| 20 | SECONDARY | CHPT | Dilutive supply |
| 21 | CORPORATE_ACTION | GE | Mechanical sell |
| 22 | ETF | XLK | 13F lag, sector vehicle |

Literal field values live in `web/src/signal-dashboard.jsx`. This appendix is the index, not a second copy.
