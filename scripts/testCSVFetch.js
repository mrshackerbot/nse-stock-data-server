import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const NSE_CSV_URL = 'https://www.nseindia.com/api/historicalOR/generateSecurityWiseHistoricalData';

const NSE_HEADERS = {
  Referer: 'https://www.nseindia.com/get-quotes/equity',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

function cleanSymbol(symbol) {
  return symbol.replace('.NS', '').replace('.BSE', '').toUpperCase();
}

async function fetchHistoricalCSV(symbol, fromDate, toDate) {
  try {
    const response = await axios.get(NSE_CSV_URL, {
      params: {
        from: fromDate,
        to: toDate,
        symbol: cleanSymbol(symbol),
        type: 'priceVolumeDeliverable',
        series: 'EQ',
        csv: 'true',
      },
      headers: NSE_HEADERS,
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
      responseType: 'text',
    });

    if (response.status === 429) {
      console.log(`[RateLimit] ${symbol}: 429, waiting 60s...`);
      await new Promise(resolve => setTimeout(resolve, 60000));
      return null;
    }

    if (response.status >= 400) {
      console.log(`[HTTP ${response.status}] ${symbol}: ${response.statusText}`);
      return null;
    }

    const lines = response.data.split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      console.log(`[Empty] ${symbol}: No data rows`);
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
        data.push({ date, open, high, low, close, volume, symbol: cleanSymbol(symbol) });
      }
    }

    console.log(`✓ CSV ${symbol}: ${data.length} records from ${fromDate} to ${toDate}`);
    return data;
  } catch (error) {
    console.log(`✗ ${symbol}: ${error.message}`);
    return null;
  }
}

async function testYearFetch(symbol, year) {
  console.log(`\n=== Testing ${symbol} ${year} ===`);
  const fromDate = `01-01-${year}`;
  const toDate = `31-12-${year}`;

  const data = await fetchHistoricalCSV(symbol, fromDate, toDate);

  if (data && data.length > 0) {
    console.log(`  First: ${data[0].date} Close: ${data[0].close}`);
    console.log(`  Last:  ${data[data.length-1].date} Close: ${data[data.length-1].close}`);
    console.log(`  Total: ${data.length} trading days`);
    // Save to temp file
    await fs.writeFile(
      path.join(rootDir, 'data', 'stocks', symbol, `${year}.json`),
      JSON.stringify(data, null, 2)
    );
    console.log(`  ✓ Saved to data/stocks/${symbol}/${year}.json`);
  } else {
    console.log(`  ✗ No data returned`);
  }
}

async function main() {
  const symbol = process.argv[2] || 'RELIANCE';
  const year = process.argv[3] || '2025';

  console.log(`Testing NSE CSV endpoint for ${symbol} ${year}`);
  await testYearFetch(symbol, parseInt(year));
}

main().catch(console.error);
