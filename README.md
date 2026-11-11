# A-share ETF Rebound Alerts (Cloudflare Workers + D1 + Bark)

Daily end-of-day monitor for Chinese broad-market ETFs. It sends Bark notifications **only for confirmed-entry and exit/stop/target signals**. It does not place orders.

## Watchlist

- 510300 — 沪深300ETF
- 510050 — 上证50ETF
- 510500 — 中证500ETF
- 159915 — 创业板ETF (higher volatility)

Verify the exact fund, exchange, trading status, liquidity, and fee schedule before using. Eastmoney's public quote endpoint is unofficial and may change, throttle, or become unavailable.

## 1. Create GitHub repository

Create an empty GitHub repository and upload this project structure:

```text
.
├── .github/workflows/deploy.yml
├── src/
│   ├── bark.ts
│   ├── eastmoney.ts
│   ├── index.ts
│   ├── indicators.ts
│   ├── strategy.ts
│   └── types.ts
├── .dev.vars.example
├── .gitignore
├── package.json
├── README.md
├── schema.sql
├── tsconfig.json
└── wrangler.toml
```

## 2. Create Cloudflare D1 database

From a local terminal:

```bash
npm install
npx wrangler login
npx wrangler d1 create a-share-etf-alerts
```

Copy the returned database ID into `wrangler.toml` at `database_id`.

Apply schema:

```bash
npm run db:migrate:remote
```

## 3. Configure Cloudflare secrets

In Cloudflare Dashboard → Workers & Pages → your Worker → Settings → Variables and Secrets, add:

- `BARK_DEVICE_KEY` (Secret): your Bark device key
- `BARK_BASE_URL` (optional): `https://api.day.app`

Do not commit the Bark key to GitHub. For local development, copy `.dev.vars.example` to `.dev.vars` and enter your key there.

## 4. Deploy with GitHub Actions

Create a Cloudflare API token with Workers Scripts: Edit and D1: Edit permissions, plus account access. Add these GitHub repository Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Then enable GitHub Actions. Push to `main` to deploy.

The workflow uses Wrangler and the `wrangler.toml` configuration. Ensure the D1 database ID is already set.

## 5. Cron schedule

`wrangler.toml` schedules `15 8 * * 1-5` UTC = 16:15 China Standard Time on weekdays. The script checks that the latest daily candle date equals the current China date, so it will skip stale or not-yet-published data. Exchange holidays are naturally skipped if no current daily bar exists.

Cron execution time is not guaranteed to be exact. Consider changing the schedule to 08:30 UTC if your chosen quote source publishes final daily bars later.

## 6. Test

After deployment:

```bash
curl https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/health
```

Manual scan (protect this endpoint; it uses the Bark key as a bearer token):

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_BARK_DEVICE_KEY" \
  https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/run
```

A successful response contains scanned count, alert count, and any per-symbol data errors.

## Strategy outline

- Crash context: 5-session return <= -5% OR 10-session return <= -8%; RSI(6) <= 20; plus close below Bollinger lower band OR volume >= 1.2x 20-session average.
- Entry confirmation: prior-session crash context; RSI recovery; close > MA5 and prior high; volume > MA5 average; MACD histogram negative but contracting for two sessions.
- Initial stop: entry reference close - 1.5 * ATR(14).
- Targets: 1.5R and 2.5R.
- Trailing exit: close below max(initial stop, highest close since entry - 2*ATR).
- Time exit: 20 trading sessions.

**Important implementation note:** This repository is a deployment starter, not a validated investment system. The included production scan implements daily signal checks and basic position-state management, but the user must record actual fills/quantities in D1 before exit alerts can be meaningfully tied to their real holdings. The sample's position table is not automatically opened on an entry signal, because an alert is not proof of a filled trade. See "Position tracking" below.

## Position tracking (manual fill registration, required for exit alerts)

An entry alert is not proof of an actual fill. After you manually buy, register your actual fill using the authenticated endpoint. It derives the initial ATR stop and R targets from the real entry price:

```bash
curl -X POST https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/positions \\
  -H 'Authorization: Bearer YOUR_BARK_DEVICE_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{"symbol":"510300","entry_date":"2026-11-11","entry_price":4.000,"quantity":5000}'
```

The endpoint stores the position in D1. Use your actual fill date, price, and quantity. Protect the endpoint and never expose the Bark key. Exit alerts are generated only for registered positions; the Worker does not place or modify orders.

## Known limitations to address before live use

1. Eastmoney's public endpoint is unofficial; implement a licensed/contractual source if reliability or redistribution terms matter.
2. Weekly/monthly filters are simplified and must be validated against completed weekly/monthly candles and exchange calendar behavior.
3. Historical signal backtesting is not included. Run a separate event-driven backtest with next-session execution, costs, slippage, suspended/stale-bar handling, and out-of-sample validation.
4. The sample position tracking requires manual entry after a real fill. It never submits orders.
5. Stop/target checks based on daily OHLC have intraday ordering ambiguity. The code conservatively checks stop before target if both occur in one candle.
6. Use only completed daily bars. If the data provider publishes late, move Cron later.
7. A missing Bark secret or Bark/API error is logged by the Worker invocation; configure Cloudflare observability/logging and test Bark before enabling the schedule.

