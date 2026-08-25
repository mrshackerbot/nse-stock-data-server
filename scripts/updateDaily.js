import axios from "axios";
import {
  DATA_DIR,
  LATEST_DIR,
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
  getNSESession,
  getNSEOptionsWithCookiesAndToken,
} from "./utils.js";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";

async function getTodayData(symbol, session = null) {
  const cleanSym = cleanSymbol(symbol);
  const yesterday = formatDate(getYesterday()).split("-").reverse().join("-");
  const today = formatDate(new Date()).split("-").reverse().join("-");
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const headers = { ...NSE_CSV_HEADERS };
      if (session && session.cookieHeader) {
        headers["Cookie"] = session.cookieHeader;
      }

      const response = await axios.get(NSE_CSV_URL, {
        params: {
          from: yesterday,
          to: today,
          symbol: cleanSym,
          type: "priceVolumeDeliverable",
          series: "EQ",
          csv: "true",
        },
        headers: headers,
        timeout: 15000,
        maxRedirects: 5,
        validateStatus: (status) => status < 500,
        responseType: "text",
      });

      if (response.status === 429) {
        const waitTime = 8 * attempt;
        log(
          `[RateLimit] ${symbol}: HTTP ${response.status}. Waiting ${waitTime}s (attempt ${attempt}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
        continue;
      }

      if (response.status >= 400) {
        log(`[HTTP ${response.status}] ${symbol}: ${response.statusText}`);
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
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

        if (cols.length < 15) continue;

        const date = cols[2]?.trim();
        const prevClose = parseFloat(cols[3]?.replace(/,/g, "")) || 0;
        const open = parseFloat(cols[4]?.replace(/,/g, "")) || 0;
        const high = parseFloat(cols[5]?.replace(/,/g, "")) || 0;
        const low = parseFloat(cols[6]?.replace(/,/g, "")) || 0;
        const lastPrice = parseFloat(cols[7]?.replace(/,/g, "")) || 0;
        const closePrice = parseFloat(cols[8]?.replace(/,/g, "")) || 0;
        const avgPrice = parseFloat(cols[9]?.replace(/,/g, "")) || 0;
        const volume = parseInt(cols[10]?.replace(/,/g, "")) || 0;
        const turnover = parseFloat(cols[11]?.replace(/,/g, "")) || 0;
        const noOfTrades = parseInt(cols[12]?.replace(/,/g, "")) || 0;
        const deliverableQty = parseInt(cols[13]?.replace(/,/g, "")) || 0;
        const pctDlyQtToTradedQty = parseFloat(cols[14]?.replace(/,/g, "")) || 0;

        if (closePrice > 0 && date) {
          data.push({
            date,
            prevClose,
            open,
            high,
            low,
            lastPrice,
            close: closePrice,
            avgPrice,
            volume,
            turnover,
            noOfTrades,
            deliverableQty,
            pctDlyQtToTradedQty,
            symbol: cleanSym,
          });
        }
      }

      if (data.length === 0) {
        log(`[NoData] ${symbol}: No valid rows`);
        return null;
      }

      // Sort by date ascending to get the most recent
      data.sort((a, b) => new Date(a.date) - new Date(b.date));

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

async function saveLatestData(symbol, latestRecord) {
  try {
    ensureDir(LATEST_DIR);
    const cleanSym = cleanSymbol(symbol);
    const fileName = formatSymbolForFilename(cleanSym) + ".json";
    const filePath = path.join(LATEST_DIR, fileName);
    await fs.writeFile(filePath, JSON.stringify(latestRecord, null, 2));
    log(`✓ Latest data saved: latest/${fileName}`);
  } catch (error) {
    log(`⚠ Failed to save latest data for ${symbol}: ${error.message}`);
  }
}

async function updateStockFile(symbol, equityDataMap = null) {
  const symbolDir = getSymbolDir(symbol);
  const cleanSym = cleanSymbol(symbol);

  // Compute today in DD-MMM-YYYY format
  const now = new Date();
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const today = `${String(now.getDate()).padStart(2, "0")}-${monthNames[now.getMonth()]}-${now.getFullYear()}`;

  try {
    let existingData = [];
    try {
      // Only read the current year's data file
      const year = today.split("-")[2];
      const yearFilePath = path.join(symbolDir, `${year}.json`);
      if (existsSync(yearFilePath)) {
        const fileContent = await fs.readFile(yearFilePath, "utf8");
        existingData = JSON.parse(fileContent);
      }
    } catch (err) {
      log(`${symbol}: No existing data for current year`);
    }

    existingData.sort((a, b) => new Date(a.date) - new Date(b.date));
    const lastDate =
      existingData.length > 0
        ? existingData[existingData.length - 1].date
        : null;

    if (lastDate === today) {
      return { symbol, status: "already_updated" };
    }

    let newData = null;

    // Try equity indices data first (fast, single API call for all stocks)
    if (equityDataMap && equityDataMap[cleanSym]) {
      const equityItem = equityDataMap[cleanSym];
      const date = equityItem.lastUpdateTime?.split(" ")[0] || today;
      const close =
        parseFloat(String(equityItem.lastPrice).replace(/,/g, "")) || 0;

      if (close > 0) {
        newData = {
          date,
          prevClose:
            parseFloat(String(equityItem.previousClose).replace(/,/g, "")) || 0,
          open:
            parseFloat(String(equityItem.dayOpen).replace(/,/g, "")) || close,
          high:
            parseFloat(String(equityItem.dayHigh).replace(/,/g, "")) || close,
          low: parseFloat(String(equityItem.dayLow).replace(/,/g, "")) || close,
          lastPrice:
            parseFloat(String(equityItem.lastPrice).replace(/,/g, "")) || 0,
          close,
          avgPrice:
            parseFloat(String(equityItem.averagePrice).replace(/,/g, "")) || 0,
          volume:
            parseInt(String(equityItem.totalTradedVolume).replace(/,/g, "")) ||
            0,
          turnover:
            parseFloat(
              String(equityItem.totalTradedValue).replace(/,/g, ""),
            ) || 0,
          noOfTrades:
            parseInt(
              String(equityItem.totalTrades).replace(/,/g, ""),
            ) || 0,
          deliverableQty:
            parseInt(
              String(equityItem.deliverableQuantity).replace(/,/g, ""),
            ) || 0,
          pctDlyQtToTradedQty:
            parseFloat(
              String(equityItem.deliverablePercent).replace(/,/g, ""),
            ) || 0,
          symbol: cleanSym,
        };
        log(`[EquityAPI] ${symbol}: Got latest data (Close: ${close})`);
      }
    }

    // Fall back to historical CSV endpoint if equity data not available
    if (!newData) {
      const session = await getNSESession();
      newData = await getTodayData(symbol, session);
    }

    if (!newData) {
      return { symbol, status: "no_new_data" };
    }

    const newDateObj = new Date(newData.date);
    const dataYear = newData.date.split("-")[2];
    const currentYear = today.split("-")[2];

    if (dataYear === currentYear) {
      const lastDateObj = lastDate ? new Date(lastDate) : new Date(0);
      if (newDateObj <= lastDateObj) {
        return { symbol, status: "no_update_needed" };
      }
      existingData.push(newData);
      existingData.sort((a, b) => new Date(a.date) - new Date(b.date));
      ensureDir(symbolDir);
      await fs.writeFile(
        path.join(symbolDir, `${currentYear}.json`),
        JSON.stringify(existingData, null, 2),
      );
      await saveLatestData(symbol, newData);
      log(`✓ ${symbol}: Added ${newData.date} (Close: ${newData.close})`);
      return {
        symbol,
        status: "updated",
        date: newData.date,
        close: newData.close,
      };
    } else {
      // New data belongs to a previous year; merge with that year's file
      let targetYearData = [];
      const targetPath = path.join(symbolDir, `${dataYear}.json`);
      if (existsSync(targetPath)) {
        const content = await fs.readFile(targetPath, "utf8");
        targetYearData = JSON.parse(content);
      }
      targetYearData.sort((a, b) => new Date(a.date) - new Date(b.date));
      const targetLastDate =
        targetYearData.length > 0
          ? targetYearData[targetYearData.length - 1].date
          : null;
      const targetLastDateObj = targetLastDate
        ? new Date(targetLastDate)
        : new Date(0);
      if (newDateObj <= targetLastDateObj) {
        return { symbol, status: "no_update_needed" };
      }
      targetYearData.push(newData);
      targetYearData.sort((a, b) => new Date(a.date) - new Date(b.date));
      ensureDir(symbolDir);
      await fs.writeFile(targetPath, JSON.stringify(targetYearData, null, 2));
      await saveLatestData(symbol, newData);
      log(
        `✓ ${symbol}: Added ${newData.date} to ${dataYear}.json (Close: ${newData.close})`,
      );
      return {
        symbol,
        status: "updated",
        date: newData.date,
        close: newData.close,
      };
    }
  } catch (error) {
    log(`✗ Failed ${symbol}: ${error.message}`);
    return { symbol, status: "failed", error: error.message };
  }
}

async function generateLatestForAll(stocks = null) {
  log("Generating latest data files for all stocks...");

  if (!stocks) {
    const metadata = await readStockList();
    stocks = metadata.stocksList || [];
  }

  if (stocks.length === 0) {
    log("No stocks available to generate latest data");
    return;
  }

  ensureDir(LATEST_DIR);

  let count = 0;
  for (const symbol of stocks) {
    try {
      const symbolDir = getSymbolDir(symbol);
      if (!existsSync(symbolDir)) continue;

      const yearFiles = await fs.readdir(symbolDir);
      let allData = [];
      for (const file of yearFiles) {
        if (file.endsWith(".json")) {
          const filePath = path.join(symbolDir, file);
          const fileData = JSON.parse(await fs.readFile(filePath, "utf8"));
          allData = allData.concat(fileData);
        }
      }

      if (allData.length === 0) continue;

      allData.sort((a, b) => new Date(a.date) - new Date(b.date));
      const latestRecord = allData[allData.length - 1];
      await saveLatestData(symbol, latestRecord);
      count++;
    } catch (err) {
      log(`⚠ Failed to generate latest for ${symbol}: ${err.message}`);
    }
  }

  log(`✅ Latest data files generated for ${count} stocks`);
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
  const batchSize = 8;

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
      await new Promise((resolve) => setTimeout(resolve, 3000));
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

  // Always generate latest files, even if no new data was fetched
  await generateLatestForAll(stocksToUpdate);

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
  const limit = process.argv[2] ? Number(process.argv[2]) : null;
  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
    console.error("Error: limit must be a non-negative integer");
    process.exit(1);
  }
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

export { dailyUpdate, updateStockFile, getTodayData, saveLatestData, generateLatestForAll };
