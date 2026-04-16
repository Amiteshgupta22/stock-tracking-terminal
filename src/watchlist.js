import fs from "node:fs/promises";
import path from "node:path";

const CONFIG_PATH = path.join(process.cwd(), "config.json");

async function loadConfig() {
  const raw = await fs.readFile(CONFIG_PATH, "utf-8");
  return JSON.parse(raw);
}

async function saveConfig(config) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

function normalizedSymbol(input) {
  return String(input || "")
    .toUpperCase()
    .trim();
}

async function main() {
  const [, , command, ...rest] = process.argv;
  const config = await loadConfig();
  config.symbols = Array.isArray(config.symbols) ? config.symbols : [];
  const current = new Set(config.symbols.map(normalizedSymbol).filter(Boolean));

  if (command === "list") {
    if (current.size === 0) {
      console.log("No symbols configured.");
      return;
    }
    console.log("Watchlist:", [...current].join(", "));
    return;
  }

  const symbol = normalizedSymbol(rest[0]);
  if (!symbol) {
    console.log("Usage:");
    console.log("  node src/watchlist.js list");
    console.log("  node src/watchlist.js add <SYMBOL>");
    console.log("  node src/watchlist.js remove <SYMBOL>");
    process.exit(1);
  }

  if (command === "add") {
    current.add(symbol);
    config.symbols = [...current];
    await saveConfig(config);
    console.log(`Added ${symbol}. Watchlist: ${config.symbols.join(", ")}`);
    return;
  }

  if (command === "remove") {
    current.delete(symbol);
    config.symbols = [...current];
    await saveConfig(config);
    console.log(`Removed ${symbol}. Watchlist: ${config.symbols.join(", ")}`);
    return;
  }

  console.log("Unknown command. Use: list | add | remove");
  process.exit(1);
}

main().catch((err) => {
  console.error(`watchlist error: ${err.message}`);
  process.exit(1);
});
