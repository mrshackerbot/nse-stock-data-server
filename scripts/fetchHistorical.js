import axios from "axios";
import fs from "fs/promises";
import path from "path";
import {
  ensureDirectories,
  ensureDir,
  DATA_DIR,
  LATEST_DIR,
  METADATA_DIR,
  copyToPublic,
  formatDate,
  cleanSymbol,
  formatSymbolForFilename,
  log,
  saveCache,
  loadCache,
  getSymbolDir,
  getNSE500Symbols,
  parseCSVLine,
  getNSESession,
  getNSEOptionsWithCookiesAndToken,
} from "./utils.js";

export const NSE_CSV_URL = 'https://www.nseindia.com/api/historicalOR/generateSecurityWiseHistoricalData';

export const NSE_CSV_HEADERS = {
  Referer: 'https://www.nseindia.com/get-quotes/equity',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

/**
 * Fetch historical data for a stock from NSE API
 * @param {string} symbol - Stock symbol to fetch
 * @param {string} fromDate - Start date in DD-MM-YYYY format
 * @param {string} toDate - End date in DD-MM-YYYY format
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {Object|null} session - Session with cookies from getNSESession()
 * @returns {Promise<Array>} Array of OHLCV data or null on failure
 */
async function fetchNSEDataCSV(symbol, fromDate, toDate, maxRetries = 3, session = null) {
  const cleanSym = cleanSymbol(symbol);
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const headers = { ...NSE_CSV_HEADERS };
      let currentSession = session;
      if (attempt > 1 || !currentSession) {
        currentSession = await getNSESession();
      }
      if (currentSession && currentSession.cookieHeader) {
        headers["Cookie"] = currentSession.cookieHeader;
      }

      const response = await axios.get(NSE_CSV_URL, {
        params: {
          from: fromDate,
          to: toDate,
          symbol: cleanSym,
          type: 'priceVolumeDeliverable',
          series: 'EQ',
          csv: 'true',
        },
        headers: headers,
        timeout: 30000,
        maxRedirects: 5,
        validateStatus: (status) => status < 500,
        responseType: 'text',
      });

      if (response.status === 429) {
        const waitTime = 15 * attempt;
        log(`[RateLimit] ${symbol}: HTTP ${response.status}. Waiting ${waitTime}s (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
        continue;
      }

      if (response.status >= 400) {
        log(`[HTTP ${response.status}] ${symbol}: ${response.statusText}`);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          continue;
        }
        return null;
      }

      const lines = response.data.split('\n').filter(l => l.trim());
      if (lines.length < 2) {
        log(`[Empty] ${symbol}: No CSV data rows`);
        return [];
      }

      const data = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);

        // parse available columns safely (some responses may omit optional columns)
        const date = cols[2]?.trim();
        const prevClose = parseFloat((cols[3] || '').replace(/,/g, '')) || 0;
        const open = parseFloat((cols[4] || '').replace(/,/g, '')) || 0;
        const high = parseFloat((cols[5] || '').replace(/,/g, '')) || 0;
        const low = parseFloat((cols[6] || '').replace(/,/g, '')) || 0;
        const lastPrice = parseFloat((cols[7] || '').replace(/,/g, '')) || 0;
        const closePrice = parseFloat((cols[8] || '').replace(/,/g, '')) || 0;
        const avgPrice = parseFloat((cols[9] || '').replace(/,/g, '')) || 0;
        const totalTradedQty = parseInt((cols[10] || '').replace(/,/g, '')) || 0; // actual volume
        const turnover = parseFloat((cols[11] || '').replace(/,/g, '')) || 0; // rupee turnover
        const noOfTrades = parseInt((cols[12] || '').replace(/,/g, '')) || 0;
        const deliverableQty = parseInt((cols[13] || '').replace(/,/g, '')) || 0;
        const percentageOfDelightedToTraded = parseFloat((cols[14] || '').replace(/,/g, '')) || 0;

        // Match updateDaily.js field names: close = closePrice (actual closing price)
        const close = closePrice;
        const volume = totalTradedQty; // corrected to use Total Traded Quantity

        if (close > 0 && date) {
          data.push({
            date,
            prevClose,
            open,
            high,
            low,
            lastPrice,
            close,
            avgPrice,
            volume,
            turnover,
            noOfTrades,
            deliverableQty,
            pctDlyQtToTradedQty: percentageOfDelightedToTraded,
            symbol: cleanSym,
          });
        }
      }

      log(`[CSV] ${symbol}: ${data.length} rows`);
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  log(`[Failed] ${symbol}: ${lastError?.message || 'Unknown error'}`);
  return null;
}

/**
 * Fetch and process historical data for a single stock
 * @param {string} symbol - Stock symbol to fetch
 * @param {number} years - Number of years of history to fetch
 * @param {boolean} useCache - Whether to use cached data
 * @returns {Promise<Object>} Result object with symbol and data array
 */
async function fetchStockData(symbol, years = 3, useCache = true) {
  const symbolDir = getSymbolDir(symbol);

  const cacheKey = formatSymbolForFilename(symbol);
  if (useCache) {
    const cached = loadCache("stocks", cacheKey);
    if (cached && cached.length > 0) {
      log(`✓ ${symbol}: ${cached.length} days (cached)`);
      return { symbol, data: cached };
    }
  }

  try {
    const yearsToFetch = [2021, 2022, 2023, 2024, 2025, 2026];
    let allData = [];

    // Get NSE session once for all year requests
    const session = await getNSESession();

    for (const year of yearsToFetch) {
      const fromDate = `01-01-${year}`;
      const toDate = `31-12-${year}`;

      const yearData = await fetchNSEDataCSV(symbol, fromDate, toDate, 3, session);

      if (yearData && Array.isArray(yearData) && yearData.length > 0) {
        allData = allData.concat(yearData);
      }

      if (year !== yearsToFetch[yearsToFetch.length - 1]) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const seen = new Set();
    const data = [];
    for (const item of allData) {
      if (!seen.has(item.date)) {
        seen.add(item.date);
        data.push(item);
      }
    }

    if (data.length > 0) {
      data.sort((a, b) => new Date(a.date) - new Date(b.date));
      log(`✓ ${symbol}: ${data.length} days`);

      if (useCache) {
        saveCache("stocks", cacheKey, data);
      }

      ensureDir(symbolDir);
      const yearData = {};
      for (const item of data) {
        const year = item.date.split("-")[2];
        if (!yearData[year]) yearData[year] = [];
        yearData[year].push(item);
      }
      for (const [year, items] of Object.entries(yearData)) {
        const yearPath = path.join(symbolDir, `${year}.json`);
        await fs.writeFile(yearPath, JSON.stringify(items, null, 2));
      }

      // Save latest data for this stock
      const latestRecord = data[data.length - 1];
      ensureDir(LATEST_DIR);
      const latestPath = path.join(LATEST_DIR, `${formatSymbolForFilename(cleanSymbol(symbol))}.json`);
      await fs.writeFile(latestPath, JSON.stringify(latestRecord, null, 2));

      return { symbol, data };
    }

    log(`✗ ${symbol}: No valid data`);
    return { symbol, data: [] };
  } catch (error) {
    log(`✗ ${symbol}: ${error.message}`);
    return { symbol, data: [] };
  }
}

/**
 * Fetch historical data for all NSE 500 stocks
 * @param {number|null} limit - Optional limit on number of stocks to fetch
 * @returns {Promise<Object>} Result object with results and failures arrays
 */
async function fetchAllHistorical(limit = null) {
  log("=".repeat(60));
  log("NSE 500 Historical Data Download");
  log("=".repeat(60));
  await ensureDirectories();

  const symbols = await getNSE500Symbols(true);
  const symbolsToFetch = limit ? symbols.slice(0, limit) : symbols;

  log(`\n📊 Fetching ${symbolsToFetch.length} stocks from NSE\n`);

  const results = [];
  const failures = [];
  const batchSize = 10;

  for (let i = 0; i < symbolsToFetch.length; i += batchSize) {
    const batch = symbolsToFetch.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(symbol => fetchStockData(symbol, 3, true))
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        const data = result.value;
        if (data.data.length > 0) {
          results.push({ symbol: data.symbol, count: data.data.length });
        } else {
          failures.push({ symbol: data.symbol, reason: 'no_data' });
        }
      } else {
        failures.push({ symbol: 'unknown', reason: result.reason?.message || 'unknown error' });
      }
    }

    const processed = Math.min(i + batchSize, symbolsToFetch.length);
    log(`Progress: ${processed}/${symbolsToFetch.length} | ✓ ${results.length} | ✗ ${failures.length}`);

    if (i + batchSize < symbolsToFetch.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const metadata = {
    lastUpdated: new Date().toISOString(),
    totalStocks: results.length,
    stocksList: results.map((r) => r.symbol),
    dataRange: {
      start: '2021-01-01',
      end: '2026-12-31',
    },
    failures: failures.slice(0, 10),
  };

  await fs.writeFile(
    path.join(METADATA_DIR, "stocksList.json"),
    JSON.stringify(metadata, null, 2),
  );

  await copyToPublic();

  log("\n" + "=".repeat(60));
  log("✅ Download Complete");
  log("=".repeat(60));
  log(`  Fetched: ${results.length} stocks`);
  log(`  Failed: ${failures.length} stocks`);
  if (failures.length > 0) {
    log(`\n  Sample failures:`);
    failures.slice(0, 5).forEach((f) => log(`    - ${f.symbol}: ${f.reason}`));
  }
  log("=".repeat(60));

  return { results, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const limit = process.argv[2] ? parseInt(process.argv[2]) : null;
  fetchAllHistorical(limit)
    .then((result) => {
      console.log("\nFinal result:", JSON.stringify(result, null, 2));
      
      // Calculate success rate
      const totalAttempts = result.results.length + result.failures.length;
      const successRate = totalAttempts > 0 ? result.results.length / totalAttempts : 0;
      const failureRate = 1 - successRate;
      
      log(`\nSuccess Rate: ${(successRate * 100).toFixed(1)}% (${result.results.length}/${totalAttempts})`);
      
      // Exit with 0 if at least 80% of stocks fetched successfully
      // Exit with 1 if too many failures (>20%) or no stocks fetched
      const exitCode = failureRate > 0.2 || totalAttempts === 0 ? 1 : 0;
      
      if (exitCode === 0) {
        log("✅ Historical fetch workflow completed successfully!");
      } else {
        log("⚠️ Historical fetch had too many failures - check logs");
      }
      
      process.exit(exitCode);
    })
    .catch((err) => {
      console.error("❌ Fatal error:", err);
      process.exit(1);
    });
}

export { fetchAllHistorical, fetchStockData, fetchNSEDataCSV };
