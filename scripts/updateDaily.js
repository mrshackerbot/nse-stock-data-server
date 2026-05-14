import axios from "axios";
import {
  DATA_DIR,
  METADATA_DIR,
  copyToPublic,
  isMarketClosed,
  formatDate,
  getYesterday,
  formatSymbolForFilename,
  log,
  readStockList,
  getNSE500Symbols,
  NSE_CSV_URL,
  NSE_CSV_HEADERS,
  cleanSymbol,
  getSymbolDir,
  ensureDir,
  fetchEquityIndicesData,
} from "./utils.js";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";

async function getTodayData(symbol) {
  const cleanSym = cleanSymbol(symbol);
  const yesterday = formatDate(getYesterday()).split("-").reverse().join("-");
  const today = formatDate(new Date()).split("-").reverse().join("-");
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(NSE_CSV_URL, {
        params: {
          from: yesterday,
          to: today,
          symbol: cleanSym,
          type: "priceVolumeDeliverable",
          series: "EQ",
          csv: "true",
        },
        headers: NSE_CSV_HEADERS,
        timeout: 30000,
        maxRedirects: 5,
        validateStatus: (status) => status < 500,
        responseType: "text",
      });

      if (response.status === 429) {
        const waitTime = 15 * attempt;
        log(
          `[RateLimit] ${symbol}: HTTP ${response.status}. Waiting ${waitTime}s (attempt ${attempt}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
        continue;
      }

      if (response.status >= 400) {
        log(`[HTTP ${response.status}] ${symbol}: ${response.statusText}`);
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
          continue;
        }
        return null;
      }

      const lines = response.data.split("\n").filter((l) => l.trim());
      if (lines.length < 2) {
        log(`[Empty] ${symbol}: No CSV data rows`);
        return null;
      }

      const data = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i]
          .split(/","/)
          .map((c) => c.replace(/"/g, "").trim());

        if (cols.length < 8) continue;

        const date = cols[2]?.trim();
        const open = parseFloat(cols[4]?.replace(/,/g, "")) || 0;
        const high = parseFloat(cols[5]?.replace(/,/g, "")) || 0;
        const low = parseFloat(cols[6]?.replace(/,/g, "")) || 0;
        const close = parseFloat(cols[7]?.replace(/,/g, "")) || 0;
        const volume = parseInt(cols[11]?.replace(/,/g, "")) || 0;

        if (close > 0 && date) {
          data.push({ date, open, high, low, close, volume, symbol: cleanSym });
        }
      }

      if (data.length === 0) {
        log(`[NoData] ${symbol}: No valid rows`);
        return null;
      }

      // Sort by date ascending to get the most recent
      data.sort((a, b) => {
        const da = a.date.split("-").map(Number); // [DD, MM, YYYY]
        const db = b.date.split("-").map(Number);
        // Compare year, month, day
        for (let i = 2; i >= 0; i--) {
          if (da[i] !== db[i]) return da[i] - db[i];
        }
        return 0;
      });

      const latest = data[data.length - 1];
      log(
        `[CSV] ${symbol}: Got ${data.length} rows, latest ${latest.date} Close: ${latest.close}`,
      );
      return latest;
    } catch (error) {
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      } else {
        log(`[Failed] ${symbol}: ${error.message}`);
      }
    }
  }

  return null;
}

async function updateStockFile(symbol, equityDataMap = null) {
  const symbolDir = getSymbolDir(symbol);

  try {
    let existingData = [];
    try {
      if (existsSync(symbolDir)) {
        const yearFiles = await fs.readdir(symbolDir);
        for (const file of yearFiles) {
          if (file.endsWith(".json")) {
            const fileContent = await fs.readFile(
              path.join(symbolDir, file),
              "utf8",
            );
            existingData = existingData.concat(JSON.parse(fileContent));
          }
        }
      }
    } catch {
      log(`${symbol}: No existing data`);
    }

    existingData.sort((a, b) => new Date(a.date) - new Date(b.date));
    const lastDate =
      existingData.length > 0
        ? existingData[existingData.length - 1].date
        : null;
    const today = formatDate(new Date()).split("-").reverse().join("-"); // DD-MM-YYYY

    if (lastDate === today) {
      return { symbol, status: "already_updated" };
    }

    let newData = null;

    // Try equity indices data first (fast, single API call for all stocks)
    if (equityDataMap && equityDataMap[symbol]) {
      const equityItem = equityDataMap[symbol];

      // Parse lastUpdateTime: "14-May-2026 16:00:00" -> "14-05-2026"
      let rawDate = equityItem.lastUpdateTime?.split(" ")[0] || today;
      let date = rawDate;
      try {
        // Handle "14-May-2026" format
        const [d, mmyyyy, y] = rawDate.split("-");
        if (d && mmyyyy && y) {
          const monthMap = {
            Jan: "01",
            Feb: "02",
            Mar: "03",
            Apr: "04",
            May: "05",
            Jun: "06",
            Jul: "07",
            Aug: "08",
            Sep: "09",
            Oct: "10",
            Nov: "11",
            Dec: "12",
          };
          const month = monthMap[mmyyyy] || "01";
          date = `${d.padStart(2, "0")}-${month}-${y}`;
        } else {
          // Try standard date parse
          const d = new Date(rawDate);
          if (!isNaN(d.getTime())) {
            date = formatDate(d).split("-").reverse().join("-");
          }
        }
      } catch (e) {
        // keep today as fallback
      }

      const close =
        parseFloat(String(equityItem.lastPrice).replace(/,/g, "")) || 0;

      if (close > 0) {
        newData = {
          date,
          open:
            parseFloat(String(equityItem.dayOpen).replace(/,/g, "")) || close,
          high:
            parseFloat(String(equityItem.dayHigh).replace(/,/g, "")) || close,
          low: parseFloat(String(equityItem.dayLow).replace(/,/g, "")) || close,
          close,
          volume:
            parseInt(String(equityItem.totalTradedVolume).replace(/,/g, "")) ||
            0,
          symbol: cleanSymbol(symbol),
        };
        log(`[EquityAPI] ${symbol}: Got latest data (Close: ${close})`);
      }
    }

    // Fall back to historical CSV endpoint if equity data not available
    if (!newData) {
      newData = await getTodayData(symbol);
    }

    if (!newData) {
      return { symbol, status: "no_new_data" };
    }

    const lastDateObj = lastDate ? new Date(lastDate) : new Date(0);
    const newDateObj = new Date(newData.date);

    if (newDateObj > lastDateObj) {
      existingData.push(newData);
      ensureDir(symbolDir);

      // Group data by year and write
      const yearData = {};
      for (const item of existingData) {
        const year = item.date.split("-")[2];
        if (!yearData[year]) yearData[year] = [];
        yearData[year].push(item);
      }
      for (const [year, items] of Object.entries(yearData)) {
        await fs.writeFile(
          path.join(symbolDir, `${year}.json`),
          JSON.stringify(items, null, 2),
        );
      }

      log(`✓ ${symbol}: Added ${newData.date} (Close: ${newData.close})`);
      return {
        symbol,
        status: "updated",
        date: newData.date,
        close: newData.close,
      };
    }

    return { symbol, status: "no_update_needed" };
  } catch (error) {
    log(`✗ Failed ${symbol}: ${error.message}`);
    return { symbol, status: "failed", error: error.message };
  }
}

async function dailyUpdate(limit = null) {
  log("=".repeat(60));
  log("Starting NSE daily stock data update...");
  log("=".repeat(60));

  if (!isMarketClosed()) {
    log(
      "⏰ Market is still open. Skipping update. Will run after market close.",
    );
    return { status: "skipped", reason: "market_open" };
  }

  const metadata = await readStockList();
  let stocks = metadata.stocksList || [];

  if (stocks.length === 0) {
    log("No stock list found in metadata. Fetching fresh list from NSE...");
    stocks = await getNSE500Symbols(true);
  }

  if (stocks.length === 0) {
    log("❌ No stocks to update");
    return { status: "failed", reason: "no_stocks_available" };
  }

  const stocksToUpdate = limit ? stocks.slice(0, limit) : stocks;
  const totalCount = stocksToUpdate.length;

  log(`\n📈 Updating ${totalCount} stocks...\n`);

  // Fetch latest equity indices data first (fast, covers most stocks in one call)
  const equityDataRaw = await fetchEquityIndicesData();
  const equityDataMap = {};
  if (equityDataRaw && Array.isArray(equityDataRaw)) {
    for (const item of equityDataRaw) {
      const sym = cleanSymbol(item.symbol);
      equityDataMap[sym] = item;
    }
    log(
      `✓ Equity indices data loaded for ${Object.keys(equityDataMap).length} stocks`,
    );
  } else {
    log(
      "⚠ Equity indices data unavailable, will use historical endpoint for all stocks",
    );
  }

  const results = [];
  const successes = [];
  const failures = [];
  const batchSize = 10;

  for (let i = 0; i < stocksToUpdate.length; i += batchSize) {
    const batch = stocksToUpdate.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((symbol) => updateStockFile(symbol, equityDataMap)),
    );
    results.push(...batchResults);

    batchResults.forEach((r) => {
      if (r.status === "updated") successes.push(r);
      else if (r.status === "failed") failures.push(r);
    });

    const processed = Math.min(i + batchSize, totalCount);
    log(
      `Progress: ${processed}/${totalCount} | ✓ ${successes.length} | ✗ ${failures.length}`,
    );

    if (i + batchSize < stocksToUpdate.length) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  const stats = {
    updated: successes.length,
    failed: failures.length,
    alreadyUpdated: results.filter((r) => r.status === "already_updated")
      .length,
    noNewData: results.filter((r) => r.status === "no_new_data").length,
    noUpdateNeeded: results.filter((r) => r.status === "no_update_needed")
      .length,
    skipped: results.filter((r) => r.status === "skipped").length,
  };

  if (stats.updated > 0) {
    const updatedMetadata = {
      ...metadata,
      lastUpdated: new Date().toISOString(),
      stocksList: results
        .filter(
          (r) =>
            r.status === "updated" ||
            r.status === "already_updated" ||
            r.status === "no_new_data",
        )
        .map((r) => r.symbol),
      totalStocks: results.length,
      lastUpdateStats: stats,
    };

    await fs.writeFile(
      path.join(METADATA_DIR, "stocksList.json"),
      JSON.stringify(updatedMetadata, null, 2),
    );

    await copyToPublic();
  }

  console.table(stats);

  log("\n" + "=".repeat(60));
  log("✅ Daily update complete!");
  log("=".repeat(60));
  log(`  Updated: ${stats.updated} stocks`);
  log(`  Already current: ${stats.alreadyUpdated}`);
  log(`  No new data: ${stats.noNewData}`);
  log(`  Failed: ${stats.failed}`);
  if (failures.length > 0) {
    const topFails = failures.slice(0, 5);
    log(`\n  Failures:`);
    topFails.forEach((f) =>
      log(`    - ${f.symbol}: ${f.error || "Unknown error"}`),
    );
  }
  log("=".repeat(60));

  return { status: "complete", stats, successes, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const limit = process.argv[2] ? parseInt(process.argv[2]) : null;
  dailyUpdate(limit)
    .then((result) => {
      console.log("\nFinal result:", JSON.stringify(result, null, 2));
      process.exit(result.status === "complete" ? 0 : 1);
    })
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
}

export { dailyUpdate, updateStockFile, getTodayData };
