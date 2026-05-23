import fs from "node:fs/promises";
import path from "node:path";

const DATA_PATH = path.join(process.cwd(), "public", "data", "latest.json");
const SITE_URL =
  process.env.SITE_URL ||
  "https://amiteshgupta22.github.io/stock-tracking-terminal/";

function formatPrice(value, symbol) {
  if (value == null || Number.isNaN(value)) return "—";
  const prefix = symbol.includes(".NS") || symbol.includes(".BO") ? "₹" : "$";
  return `${prefix}${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function main() {
  const raw = await fs.readFile(DATA_PATH, "utf-8");
  const data = JSON.parse(raw);
  const symbols = data.symbols || {};
  const entries = Object.entries(symbols);

  const rows = entries
    .map(([symbol, details]) => {
      const q = details.quote || {};
      const pct = q.dayChangePct ?? 0;
      const color = pct > 0 ? "#34d399" : pct < 0 ? "#f87171" : "#94a3b8";
      const sign = pct > 0 ? "+" : "";
      return `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #334155;">
            <strong>${escapeHtml(details.label || symbol)}</strong><br/>
            <span style="color:#94a3b8;font-size:12px;">${escapeHtml(symbol)}</span>
          </td>
          <td style="padding:8px;border-bottom:1px solid #334155;">${formatPrice(q.current, symbol)}</td>
          <td style="padding:8px;border-bottom:1px solid #334155;color:${color};">${sign}${Number(pct).toFixed(2)}%</td>
        </tr>`;
    })
    .join("");

  const updated = data.generatedAt
    ? new Date(data.generatedAt).toLocaleString("en-IN", {
        dateStyle: "full",
        timeStyle: "short",
      })
    : "unknown";

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;padding:16px;">
  <h2 style="color:#f59e0b;">India Stock Tracker — Daily Update</h2>
  <p style="color:#94a3b8;">${escapeHtml(updated)} · ${escapeHtml(data.market || "NSE")}</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <thead>
      <tr style="text-align:left;color:#94a3b8;font-size:12px;">
        <th style="padding:8px;">Stock</th>
        <th style="padding:8px;">Price</th>
        <th style="padding:8px;">Day %</th>
      </tr>
    </thead>
    <tbody>${rows || "<tr><td colspan='3'>No stock data in this run.</td></tr>"}</tbody>
  </table>
  <p><a href="${escapeHtml(SITE_URL)}" style="color:#22d3ee;">Open full dashboard</a></p>
  <p style="color:#64748b;font-size:12px;">Automated message from stock-tracking-terminal.</p>
</body>
</html>`;

  const text = entries
    .map(([symbol, d]) => {
      const q = d.quote || {};
      return `${d.label || symbol}: ${formatPrice(q.current, symbol)} (${q.dayChangePct ?? 0}%)`;
    })
    .join("\n");

  const outDir = process.env.EMAIL_OUT_DIR || process.cwd();
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "digest.html"), html, "utf-8");
  await fs.writeFile(
    path.join(outDir, "digest.txt"),
    `India Stock Tracker\n${updated}\n\n${text}\n\nDashboard: ${SITE_URL}\n`,
    "utf-8"
  );
  console.log(`Wrote email digest (${entries.length} symbols)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
