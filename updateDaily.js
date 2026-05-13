import axios from "axios";
import fs from "fs/promises";
import path from "path";
import {
  ensureDirectories,
  ensureDir,
  DATA_DIR,
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
} from "./utils.js";

export const NSE_CSV_URL = 'https://www.nseindia.com/api/historicalOR/generateSecurityWiseHistoricalData';

export const NSE_CSV_HEADERS = {
  Referer: 'https://www.nseindia.com/get-quotes/equity',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

async function fetchNSEDataCSV(symbol, fromDate, toDate, maxRetries = 3) {
  const cleanSym = cleanSymbol(symbol);
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(NSE_CSV_URL, {
        params: {
          from: fromDate,
          to: toDate,
          symbol: cleanSym,
          type: 'priceVolumeDeliverable',
          series: 'EQ',
          csv: 'true',
        },
        headers: NSE_CSV_HEADERS,
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
        const cols = lines[i]
          .split(/","/)
          .map(c => c.replace(/"/g, '').trim());

        if (cols.length < 8) continue;

        const date = cols[2]?.trim();
        const open = parseFloat(cols[4]?.replace(/,/g, '')) || 0;
        const high = parseFloat(cols[5]?.replace(/,/g, '')) || 0;
        const low = parseFloat(cols[6]?.replace(/,/g, '')) || 0;
        const close = parseFloat(cols[7]?.replace(/,/g, '')) || 0;
        const volume = parseInt(cols[11]?.replace(/,/g, '')) || 0;

        if (close > 0 && date) {
          data.push({ date, open, high, low, close, volume, symbol: cleanSym });
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

    for (const year of yearsToFetch) {
      const fromDate = `01-01-${year}`;
      const toDate = `31-12-${year}`;

      const yearData = await fetchNSEDataCSV(symbol, fromDate, toDate);

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

      return { symbol, data };
    }

    log(`✗ ${symbol}: No valid data`);
    return { symbol, data: [] };
  } catch (error) {
    log(`✗ ${symbol}: ${error.message}`);
    return { symbol, data: [] };
  }
}

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
  fetchAllHistorical(limit).catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

export { fetchAllHistorical, fetchStockData, fetchNSEDataCSV };
