#!/usr/bin/env node

/**
 * Quick start script to fetch sample data (5 stocks) for testing
 * Run: node scripts/sample.js
 */

import { mkdirSync, existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { fetchStockData } from "./fetchHistorical.js";
import { formatDate, cleanSymbol, log, LATEST_DIR, ensureDir, formatSymbolForFilename } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

const DATA_DIR = path.join(rootDir, "data", "stocks");
const METADATA_DIR = path.join(rootDir, "data", "metadata");

const SAMPLE_STOCKS = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "HINDUNILVR"];

async function ensureDataDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(METADATA_DIR, { recursive: true });
}

function ensureDirSync(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function fetchSampleData(years = 5, useCache = true) {
  console.log(`🚀 Fetching sample NSE data for ${SAMPLE_STOCKS.length} stocks (${years} years)...\n`);
  await ensureDataDirs();

  const results = [];

  for (let i = 0; i < SAMPLE_STOCKS.length; i++) {
    const symbol = SAMPLE_STOCKS[i];

    try {
      const result = await fetchStockData(symbol, years, useCache);

      if (result.data && result.data.length > 0) {
        // Save to symbol/year files (fetchStockData only uses cache;
        // we also persist to the folder structure here)
        const symbolDir = path.join(DATA_DIR, cleanSymbol(symbol));
        ensureDirSync(symbolDir);

        const yearData = {};
        for (const item of result.data) {
          const year = item.date.split("-")[2];
          if (!yearData[year]) yearData[year] = [];
          yearData[year].push(item);
        }
        for (const [year, items] of Object.entries(yearData)) {
          const yearPath = path.join(symbolDir, `${year}.json`);
          await fs.writeFile(yearPath, JSON.stringify(items, null, 2));
        }

        // Save latest data for this stock
        ensureDir(LATEST_DIR);
        const latestRecord = result.data[result.data.length - 1];
        const latestPath = path.join(LATEST_DIR, `${formatSymbolForFilename(cleanSymbol(symbol))}.json`);
        await fs.writeFile(latestPath, JSON.stringify(latestRecord, null, 2));

        results.push({ symbol, count: result.data.length });
      } else {
        log(`✗ ${symbol}: No data returned`);
      }

      if (i < SAMPLE_STOCKS.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (err) {
      log(`✗ ${symbol}: ${err.message}`);
    }
  }

  if (results.length > 0) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);

    const metadata = {
      lastUpdated: new Date().toISOString(),
      totalStocks: results.length,
      stocksList: results.map((r) => r.symbol),
      dataRange: {
        start: formatDate(startDate),
        end: formatDate(endDate),
      },
    };

    await fs.writeFile(
      path.join(METADATA_DIR, "stocksList.json"),
      JSON.stringify(metadata, null, 2),
    );

    console.log("\n✅ Sample fetch complete!");
    console.log(`\n📂 Data saved to: ${DATA_DIR}`);
    console.log(`📋 Metadata: ${METADATA_DIR}/stocksList.json`);
    console.log("\n📋 Next steps:");
    console.log("   npm run build              # Build static files");
    console.log("   npm start                  # Start server");
    console.log("   Open http://localhost:3000\n");
  } else {
    console.error("\n❌ No data was fetched. Check your internet connection.");
    process.exit(1);
  }
}

const years = process.argv[2] ? parseInt(process.argv[2]) : 5;
const useCache = process.argv[3] !== "--no-cache";

fetchSampleData(years, useCache).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});