# Stock Tracking Terminal

Simple terminal tool to track stock news + sudden price moves with Gemini summaries.

## Features

- Monitors configured stock symbols on an interval
- Detects fresh company news and summarizes using Gemini API
- Detects sudden price movement (configurable threshold)
- Generates an end-of-day summary per stock with long-term impact
- Prints everything directly in terminal
- Supports watchlist management from terminal (`add/remove/list`)
- Writes latest output to `public/data/latest.json` for a website view
- Includes GitHub Actions cron workflow for scheduled updates

## Setup

1. Create API keys:
   - Finnhub key (free): https://finnhub.io/register
   - Gemini API key (free tier): https://aistudio.google.com/app/apikey

2. Create config:
   - Copy `config.example.json` to `config.json`
   - Update symbols and thresholds

3. Set environment variables (PowerShell):
   ```powershell
   $env:FINNHUB_KEY="your_finnhub_key"
   $env:GEMINI_API_KEY="your_gemini_key"
   ```

4. Run tracker:
   ```bash
   npm start
   ```

## Manage your own stock symbols

Use these commands:

```bash
npm run watchlist:list
npm run watchlist:add -- NVDA
npm run watchlist:remove -- TSLA
```

The watchlist is stored in `config.json` under `symbols`.

## Website view

Open `public/index.html` locally, or host it with GitHub Pages.  
The tracker writes data to `public/data/latest.json`.

## GitHub + cron automation

The workflow file is `.github/workflows/tracker.yml`.

1. Push this project to a GitHub repository
2. Add repository secrets:
   - `FINNHUB_KEY`
   - `GEMINI_API_KEY`
3. Enable Actions
4. (Optional) Enable GitHub Pages and serve from branch root

Workflow runs once per day (16:00 UTC) and supports manual run (`workflow_dispatch`).

Live dashboard: https://amiteshgupta22.github.io/stock-tracking-terminal/

## Email notifications (daily digest)

The app does **not** email you by default. GitHub only emails you when a workflow **fails**, not when it succeeds.

To get a **daily summary email** after each successful run, add these GitHub secrets  
(Settings → Secrets and variables → Actions):

| Secret | Example |
|--------|---------|
| `NOTIFY_EMAIL` | your@gmail.com (where you receive mail) |
| `SMTP_USERNAME` | your@gmail.com (sender) |
| `SMTP_PASSWORD` | Gmail **App Password** (not your normal password) |

Gmail app password: Google Account → Security → 2-Step Verification → App passwords.

After secrets are set, each successful workflow run sends one digest with prices and day % change.

### Actions troubleshooting

If you see errors like `git stash`, `dashboard-data`, or merge conflict on `latest.json`:

- That is from an **old failed run** (workflow v1).
- **Do not click "Re-run failed jobs"** on red runs — GitHub re-executes the old broken script.
- Instead: **Actions → Stock Tracker Scheduler → Run workflow** (top right).
- A correct run shows step **"Publish dashboard data"** and log line `Workflow v2`.

## Config Options

- `symbols`: list of stocks to track
- `pollIntervalMinutes`: poll frequency
- `suddenMovePercent`: alert threshold vs last poll price
- `endOfDayLocalTime`: local time for EOD report, e.g. `16:00`
- `maxNewsPerSymbolPerPoll`: max articles to process each cycle
