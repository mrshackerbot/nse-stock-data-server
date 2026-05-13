import axios from 'axios';
import { DATA_DIR, METADATA_DIR, copyToPublic, isMarketClosed, formatDate, getYesterday, formatSymbolForFilename, log, readStockList, getNSE500Symbols, NSE_HISTORICAL_URL, NSE_HEADERS, cleanSymbol, getSymbolDir, ensureDir } from './utils.js';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';

async function getTodayData(symbol) {
  try {
    const cleanSym = cleanSymbol(symbol);
    const yesterday = formatDate(getYesterday()).split('-').reverse().join('-');
    const today = formatDate(new Date()).split('-').reverse().join('-');

    const response = await axios.get(NSE_HISTORICAL_URL, {
      params: {
        functionName: "getHistoricalTradeData",
        symbol: cleanSym,
        fromDate: yesterday,
        toDate: today,
        series: 'EQ',
      },
      headers: NSE_HEADERS,
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500
    });

    if (response.status === 404) {
      return null;
    }

    if (response.status >= 400) {
      log(`[HTTP ${response.status}] ${symbol}: ${response.statusText}`);
      return null;
    }

    const jsonData = response.data;
    if (!Array.isArray(jsonData) || jsonData.length === 0) {
      return null;
    }

    for (let i = jsonData.length - 1; i >= 0 && i >= jsonData.length - 5; i--) {
      const item = jsonData[i];
      const date = item.mtimestamp?.trim();
      const open = parseFloat(item.chOpeningPrice) || 0;
      const high = parseFloat(item.chTradeHighPrice) || 0;
      const low = parseFloat(item.chTradeLowPrice) || 0;
      const close = parseFloat(item.chClosingPrice) || 0;
      const volume = parseInt(item.chTotTradedQty) || 0;

      if (close > 0 && date) {
        return {
          date,
          open,
          high,
          low,
          close,
          volume,
          symbol: cleanSym
        };
      }
    }

    return null;
    } catch (error) {
      if (error.response?.status === 429) {
        log(`[RateLimit] ${symbol}: Waiting 60s...`); // Increased from 30s to 60s
        await new Promise(resolve => setTimeout(resolve, 60000));
        return await getTodayData(symbol);
      }
    if (error.response?.status === 404) {
      log(`[NotFound] ${symbol}: No data`);
    } else {
      log(`[Error] ${symbol}: ${error.message}`);
    }
    return null;
  }
}

async function updateStockFile(symbol) {
   const symbolDir = getSymbolDir(symbol);

   try {
     let existingData = [];
     try {
       if (existsSync(symbolDir)) {
         const yearFiles = await fs.readdir(symbolDir);
         for (const file of yearFiles) {
           if (file.endsWith('.json')) {
             const fileContent = await fs.readFile(path.join(symbolDir, file), 'utf8');
             existingData = existingData.concat(JSON.parse(fileContent));
           }
         }
       }
     } catch {
       log(`${symbol}: No existing data`);
     }

     existingData.sort((a, b) => new Date(a.date) - new Date(b.date));
     const lastDate = existingData.length > 0 ? existingData[existingData.length - 1].date : null;
     const today = formatDate(new Date());

     if (lastDate === today) {
       return { symbol, status: 'already_updated' };
     }

     const newData = await getTodayData(symbol);
     if (!newData) {
       return { symbol, status: 'no_new_data' };
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
           JSON.stringify(items, null, 2)
         );
       }

       log(`✓ ${symbol}: Added ${newData.date} (Close: ${newData.close})`);
       return { symbol, status: 'updated', date: newData.date, close: newData.close };
     }

     return { symbol, status: 'no_update_needed' };

   } catch (error) {
     log(`✗ Failed ${symbol}: ${error.message}`);
     return { symbol, status: 'failed', error: error.message };
   }
 }

async function dailyUpdate(limit = null) {
  log('='.repeat(60));
  log('Starting NSE daily stock data update...');
  log('='.repeat(60));

  if (!isMarketClosed()) {
    log('⏰ Market is still open. Skipping update. Will run after market close.');
    return { status: 'skipped', reason: 'market_open' };
  }

  const metadata = await readStockList();
  let stocks = metadata.stocksList || [];

  if (stocks.length === 0) {
    log('No stock list found in metadata. Fetching fresh list from NSE...');
    stocks = await getNSE500Symbols(true);
  }

  if (stocks.length === 0) {
    log('❌ No stocks to update');
    return { status: 'failed', reason: 'no_stocks_available' };
  }

  const stocksToUpdate = limit ? stocks.slice(0, limit) : stocks;
  const totalCount = stocksToUpdate.length;

  log(`\n📈 Updating ${totalCount} stocks...\n`);

  const results = [];
  const successes = [];
  const failures = [];
  const batchSize = 3; // Reduced from 5 to avoid rate limiting

  for (let i = 0; i < stocksToUpdate.length; i += batchSize) {
    const batch = stocksToUpdate.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(symbol => updateStockFile(symbol)));
    results.push(...batchResults);

    batchResults.forEach(r => {
      if (r.status === 'updated') successes.push(r);
      else if (r.status === 'failed') failures.push(r);
    });

    const processed = Math.min(i + batchSize, totalCount);
    log(`Progress: ${processed}/${totalCount} | ✓ ${successes.length} | ✗ ${failures.length}`);

    if (i + batchSize < stocksToUpdate.length) {
      // Increased from 3s to 10s between batches
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }

  const stats = {
    updated: successes.length,
    failed: failures.length,
    alreadyUpdated: results.filter(r => r.status === 'already_updated').length,
    noNewData: results.filter(r => r.status === 'no_new_data').length,
    noUpdateNeeded: results.filter(r => r.status === 'no_update_needed').length,
    skipped: results.filter(r => r.status === 'skipped').length
  };

  if (stats.updated > 0) {
    const updatedMetadata = {
      ...metadata,
      lastUpdated: new Date().toISOString(),
      stocksList: results
        .filter(r => r.status === 'updated' || r.status === 'already_updated' || r.status === 'no_new_data')
        .map(r => r.symbol),
      totalStocks: results.length,
      lastUpdateStats: stats
    };

    await fs.writeFile(
      path.join(METADATA_DIR, 'stocksList.json'),
      JSON.stringify(updatedMetadata, null, 2)
    );

    await copyToPublic();
  }

  console.table(stats);

  log('\n' + '='.repeat(60));
  log('✅ Daily update complete!');
  log('='.repeat(60));
  log(`  Updated: ${stats.updated} stocks`);
  log(`  Already current: ${stats.alreadyUpdated}`);
  log(`  No new data: ${stats.noNewData}`);
  log(`  Failed: ${stats.failed}`);
  if (failures.length > 0) {
    const topFails = failures.slice(0, 5);
    log(`\n  Failures:`);
    topFails.forEach(f => log(`    - ${f.symbol}: ${f.error || 'Unknown error'}`));
  }
  log('='.repeat(60));

  return { status: 'complete', stats, successes, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const limit = process.argv[2] ? parseInt(process.argv[2]) : null;
  dailyUpdate(limit).then(result => {
    console.log('\nFinal result:', JSON.stringify(result, null, 2));
    process.exit(result.status === 'complete' ? 0 : 1);
  }).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

export { dailyUpdate, updateStockFile, getTodayData };
