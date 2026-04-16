import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, "config.json");
const CACHE_PATH = path.join(ROOT, ".tracker-cache.json");
const OUTPUT_DIR = path.join(ROOT, "public", "data");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "latest.json");
let geminiCooldownUntil = 0;

function nowIso() {
  return new Date().toISOString();
}

function localDateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function logLine(message) {
  console.log(`[${nowIso()}] ${message}`);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadConfig() {
  if (!(await fileExists(CONFIG_PATH))) {
    throw new Error(
      "Missing config.json. Copy config.example.json to config.json and customize symbols."
    );
  }
  const raw = await fs.readFile(CONFIG_PATH, "utf-8");
  const config = JSON.parse(raw);
  if (!Array.isArray(config.symbols) || config.symbols.length === 0) {
    throw new Error("config.json must include a non-empty 'symbols' array.");
  }
  if (!process.env.FINNHUB_KEY) {
    throw new Error("Missing FINNHUB_KEY environment variable.");
  }
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY environment variable.");
  }
  return {
    symbols: config.symbols.map((s) => String(s).toUpperCase().trim()),
    pollIntervalMinutes: Number(config.pollIntervalMinutes ?? 5),
    suddenMovePercent: Number(config.suddenMovePercent ?? 2),
    endOfDayLocalTime: String(config.endOfDayLocalTime ?? "16:00"),
    maxNewsPerSymbolPerPoll: Number(config.maxNewsPerSymbolPerPoll ?? 5),
  };
}

async function loadCache() {
  if (!(await fileExists(CACHE_PATH))) {
    return {
      seenNews: {},
      lastPrices: {},
      dayData: {},
      eodRunDate: null,
    };
  }
  const raw = await fs.readFile(CACHE_PATH, "utf-8");
  return JSON.parse(raw);
}

async function saveCache(cache) {
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

async function saveLatestSnapshot(snapshot) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2), "utf-8");
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function getQuote(symbol) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_KEY}`;
  const data = await fetchJson(url);
  return {
    current: Number(data.c ?? 0),
    previousClose: Number(data.pc ?? 0),
  };
}

function dateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function getNews(symbol, maxItems) {
  const from = dateDaysAgo(1);
  const to = localDateKey();
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${process.env.FINNHUB_KEY}`;
  const rows = await fetchJson(url);
  return (Array.isArray(rows) ? rows : []).slice(0, maxItems);
}

async function askGemini(prompt) {
  if (Date.now() < geminiCooldownUntil) {
    throw new Error("Gemini cooldown active after rate limit");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 350,
    },
  };
  const delaysMs = [1000, 2500];
  let lastStatus = null;

  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      const text =
        data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") ??
        "No summary returned.";
      return text.trim();
    }

    lastStatus = res.status;
    // Retry only for throttling / transient server failures.
    if ((res.status === 429 || res.status >= 500) && attempt < delaysMs.length) {
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
      continue;
    }
    break;
  }

  if (lastStatus === 429) {
    // Free tier commonly throttles; avoid hammering API on every symbol.
    geminiCooldownUntil = Date.now() + 10 * 60 * 1000;
    throw new Error("Gemini failed: 429 (cooldown 10m)");
  }

  throw new Error(`Gemini failed: ${lastStatus ?? "unknown"}`);
}

function movePercent(current, base) {
  if (!base) return 0;
  return ((current - base) / base) * 100;
}

function makeNewsId(item) {
  return String(item.id ?? `${item.headline}-${item.datetime}`);
}

function isPastTime(localTimeHHMM) {
  const [h, m] = localTimeHHMM.split(":").map(Number);
  const now = new Date();
  const trigger = new Date(now);
  trigger.setHours(h || 0, m || 0, 0, 0);
  return now >= trigger;
}

async function summarizeNewsForSymbol(symbol, newsItems, quote) {
  const compactNews = newsItems.map((n) => ({
    headline: n.headline,
    source: n.source,
    summary: n.summary,
    datetime: n.datetime,
  }));
  const prompt = `
You are a stock analyst assistant.
Symbol: ${symbol}
Current price: ${quote.current}
Previous close: ${quote.previousClose}

New articles:
${JSON.stringify(compactNews, null, 2)}

Return a concise terminal-friendly summary with:
1) 3-6 bullet points for key updates
2) likely short-term price impact: bullish/bearish/neutral with reason
3) any headline that could trigger sudden movement
`.trim();
  try {
    return await askGemini(prompt);
  } catch (err) {
    const top = newsItems
      .slice(0, 3)
      .map((n, i) => `- ${i + 1}. ${n.headline} (${n.source || "unknown"})`)
      .join("\n");
    const dayPct = movePercent(quote.current, quote.previousClose).toFixed(2);
    return [
      "Gemini summary unavailable (likely quota/rate limit).",
      `- Price snapshot: ${quote.current.toFixed(2)} (${dayPct}% vs prev close)`,
      `- New items: ${newsItems.length}`,
      top || "- No headline details available",
      "- Impact: review headlines manually; short-term volatility possible.",
      `- Technical note: ${err.message}`,
    ].join("\n");
  }
}

async function endOfDaySummary(symbol, dayRecord) {
  const prompt = `
You are a long-term fundamental equity analyst.
Symbol: ${symbol}
Price events today: ${JSON.stringify(dayRecord.priceEvents ?? [], null, 2)}
News events today: ${JSON.stringify(dayRecord.newsEvents ?? [], null, 2)}

Create an end-of-day summary with:
- what happened today
- long-term implications (3-12 months)
- risk factors
- confidence: low/medium/high
Keep it practical and concise.
`.trim();
  try {
    return await askGemini(prompt);
  } catch (err) {
    const newsCount = (dayRecord.newsEvents ?? []).length;
    const moveCount = (dayRecord.priceEvents ?? []).length;
    return [
      "Gemini EOD analysis unavailable (likely quota/rate limit).",
      `- Day recap: ${newsCount} news events, ${moveCount} sudden move alerts.`,
      "- Long-term implication: infer from repeated themes in headlines.",
      "- Risk factors: macro news, earnings guidance, regulation, liquidity.",
      "- Confidence: low (fallback mode).",
      `- Technical note: ${err.message}`,
    ].join("\n");
  }
}

async function runTracker() {
  const runOnce = process.argv.includes("--once");
  const config = await loadConfig();
  const cache = await loadCache();
  const todayKey = localDateKey();

  for (const s of config.symbols) {
    cache.seenNews[s] ??= [];
    cache.dayData[s] ??= { date: todayKey, priceEvents: [], newsEvents: [] };
    if (cache.dayData[s].date !== todayKey) {
      cache.dayData[s] = { date: todayKey, priceEvents: [], newsEvents: [] };
    }
  }

  logLine(`Tracking symbols: ${config.symbols.join(", ")}`);

  const tick = async () => {
    const snapshot = {
      generatedAt: nowIso(),
      symbols: {},
    };

    for (const symbol of config.symbols) {
      try {
        const quote = await getQuote(symbol);
        const prev = cache.lastPrices[symbol] ?? quote.previousClose;
        const pct = movePercent(quote.current, prev);
        const dayPct = movePercent(quote.current, quote.previousClose);

        logLine(
          `${symbol} price ${quote.current.toFixed(2)} (${dayPct.toFixed(
            2
          )}% vs prev close)`
        );

        if (Math.abs(pct) >= config.suddenMovePercent) {
          const alert = {
            time: nowIso(),
            from: Number(prev.toFixed(2)),
            to: Number(quote.current.toFixed(2)),
            changePct: Number(pct.toFixed(2)),
          };
          cache.dayData[symbol].priceEvents.push(alert);
          logLine(
            `ALERT ${symbol}: sudden move ${alert.changePct}% (${alert.from} -> ${alert.to})`
          );
        }

        cache.lastPrices[symbol] = quote.current;
        snapshot.symbols[symbol] = {
          quote: {
            current: quote.current,
            previousClose: quote.previousClose,
            dayChangePct: Number(dayPct.toFixed(2)),
          },
          newHeadlines: [],
          summary: null,
          alertsToday: cache.dayData[symbol].priceEvents,
        };

        const articles = await getNews(symbol, config.maxNewsPerSymbolPerPoll);
        const seen = new Set(cache.seenNews[symbol]);
        const fresh = articles.filter((a) => !seen.has(makeNewsId(a)));

        if (fresh.length > 0) {
          for (const item of fresh) {
            const event = {
              time: nowIso(),
              headline: item.headline,
              source: item.source,
              url: item.url,
            };
            cache.dayData[symbol].newsEvents.push(event);
            cache.seenNews[symbol].push(makeNewsId(item));
          }

          logLine(`${symbol} has ${fresh.length} new article(s). Summarizing...`);
          const summary = await summarizeNewsForSymbol(symbol, fresh, quote);
          snapshot.symbols[symbol].summary = summary;
          snapshot.symbols[symbol].newHeadlines = fresh.map((f) => ({
            headline: f.headline,
            source: f.source,
            url: f.url,
          }));
          console.log(`\n=== ${symbol} NEWS SUMMARY ===\n${summary}\n`);
        }
      } catch (err) {
        logLine(`Error on ${symbol}: ${err.message}`);
      }
    }

    if (
      isPastTime(config.endOfDayLocalTime) &&
      cache.eodRunDate !== localDateKey()
    ) {
      logLine("Running end-of-day summaries...");
      for (const symbol of config.symbols) {
        try {
          const report = await endOfDaySummary(symbol, cache.dayData[symbol]);
          if (!snapshot.symbols[symbol]) {
            snapshot.symbols[symbol] = {};
          }
          snapshot.symbols[symbol].endOfDay = report;
          console.log(`\n=== ${symbol} END OF DAY ===\n${report}\n`);
        } catch (err) {
          logLine(`EOD error on ${symbol}: ${err.message}`);
        }
      }
      cache.eodRunDate = localDateKey();
    }

    await saveCache(cache);
    await saveLatestSnapshot(snapshot);
  };

  await tick();
  if (runOnce) {
    return;
  }
  const intervalMs = config.pollIntervalMinutes * 60 * 1000;
  setInterval(() => {
    tick().catch((err) => logLine(`Tick failed: ${err.message}`));
  }, intervalMs);
}

runTracker().catch((err) => {
  console.error(`[${nowIso()}] Fatal: ${err.message}`);
  process.exit(1);
});
