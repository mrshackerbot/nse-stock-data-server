# Architecture Overview

## Components

```
┌─────────────────┐     ┌──────────────┐     ┌──────────────┐
│   NSE India API │────▶│ Data Fetcher │────▶│    Cache     │
│   (CSV format)  │     │  (Scripts)   │     │  (24h TTL)   │
└─────────────────┘     └──────────────┘     └──────────────┘
                                                       │
┌─────────────────┐     ┌──────────────┐     ┌────────▼──────┐
│ GitHub Pages    │◀────│ Static Build │◀────│  DataStore   │
│  (Static Host)  │     │   (JSON)     │     │  (JSON files)│
└─────────────────┘     └──────────────┘     └──────────────┘
                                                       │
┌─────────────────┐     ┌──────────────┐     ┌────────▼──────┐
│   Express API   │────▶│     CDN     │────▶│  Cache Layer │
│  (Local dev)    │     │ (Cloudflare) │     │              │
└─────────────────┘     └──────────────┘     └──────────────┘
```

## Data Flow

### 1. Historical Fetch
```
scripts/fetchHistorical.js
   │
   ├─▶ Get NSE 500 symbols from NSE API or fallback list
   │
   ├─▶ For each symbol:
   │     ├─▶ Fetch 3 years of historical CSV data from NSE
   │     ├─▶ Parse OHLCV + volume
   │     ├─▶ Save to data/stocks/{SYMBOL}.json
   │     ├─▶ Cache in data/cache/stocks/{SYMBOL}.json (24h)
   │     └─▶ Wait 3 seconds (rate limit)
   │
   └─▶ Generate metadata + copy to public/data/
```

### 2. Daily Update
```
scripts/updateDaily.js
   │
   ├─▶ Check if market closed (>= 4 PM IST)
   │
   ├─▶ Read stock list from metadata
   │
   ├─▶ For each stock (batch 5):
   │     ├─▶ Fetch last 5 days from NSE
   │     ├─▶ Compare with last date in JSON
   │     ├─▶ Append new trading day if exists
   │     └─▶ Wait 3 seconds (rate limit)
   │
   └─▶ Update metadata + rebuild public/
```

### 3. API Server
```
src/server.js (Express)
   │
   ├─▶ GET /api/stocks
   │     └─▶ List all symbols with pagination
   │
   ├─▶ GET /api/stocks/:symbol
   │     ├─▶ Load JSON from public/data/stocks/
   │     ├─▶ Apply filters (from, to, limit)
   │     └─▶ Return JSON or CSV
   │
   └─▶ GET /api/metadata
         └─▶ Return stocksList.json
```

### 4. GitHub Actions
```
.github/workflows/fetch-historical.yml (manual)
   └─▶ Runs: npm run fetch-historical → commit → push

.github/workflows/daily-update.yml (scheduled 4:00 PM IST)
   └─▶ Runs: npm run update-daily → build → commit → push
```

## File Structure

```
nse-stock-data-server/
├── scripts/
│   ├── utils.js              # Shared utilities + NSE API client
│   │                          # • getNSE500Symbols() - fetch symbol list
│   │                          # • fetchNSEData() - GET historical CSV
│   │                          # • parseCSVLine() - NSE CSV parser
│   │                          # • log(), formatDate(), etc.
│   │
│   ├── fetchHistorical.js    # Initial 3-year download
│   │                          # • fetchAllHistorical()
│   │                          # • fetchStockData() with cache
│   │
│   ├── updateDaily.js        # Daily append job
│   │                          # • dailyUpdate()
│   │                          # • updateStockFile()
│   │
│   ├── build.js              # Static site builder
│   │                          # • Copies data/ → public/data/
│   │                          # • Prepares GitHub Pages
│   │
│   └── sample.js             # Quick test (5 stocks)
│
├── data/
│   ├── stocks/               # Master data source (gitignored for cache)
│   │   ├── RELIANCE.json
│   │   ├── TCS.json
│   │   └── ...
│   │
│   ├── metadata/
│   │   └── stocksList.json   # { stocksList[], totalStocks, lastUpdated }
│   │
│   └── cache/                # Local cache (not committed)
│       ├── stocks/
│       └── system/
│
├── public/                   # GitHub Pages root
│   ├── index.html            # API documentation
│   ├── .nojekyll             # Disable Jekyll processing
│   └── data/
│       ├── stocks/           # Served as static files
│       └── metadata/
│
├── src/
│   └── server.js             # Express API server (local dev)
│
├── tests/
│   └── server.test.js        # Integration tests
│
└── .github/workflows/
    ├── fetch-historical.yml  # Manual data fetch
    └── daily-update.yml      # Scheduled daily update
```

## NSE API Integration Details

### Endpoint: `https://www.nseindia.com/api/historical/securities-wise-historical-data`

**Parameters:**
```
symbol: RELIANCE
from: 01-01-2021
to: 31-12-2024
series: EQ
type: priceVolumeDeliverable
csv: true
```

**Headers:**
```
User-Agent: Mozilla/5.0 (Chrome 120.0...)
Accept: text/csv,application/csv,*/*
Referer: https://www.nseindia.com/get-quotes/equity
X-Requested-With: XMLHttpRequest
```

**Response:** CSV text
```
"Date","Open","High","Low","Close","Prev Close","Volume","Value"
"01-01-2024","2850.50","2875.30","2840.00","2865.75","2840.00","2456789","7000000000"
...
```

### Rate Limit Handling

- **Delay between stocks:** 3 seconds
- **Retries:** Up to 3 attempts per stock
- **Backoff:** Exponential (5s, 10s, 15s)
- **429 handling:** Wait 30 seconds + retry

## Caching Strategy

### Layers

1. **Local filesystem** (`data/stocks/`): Source of truth
2. **Memory cache** (not implemented): Optional Redis
3. **Server response cache** (`Cache-Control: max-age=3600`)
4. **CDN cache** (Cloudflare): Edge caching

### Cache Keys

- `system:nse_500_symbols` - Symbol list, refreshed every 24h
- `stocks:{SYMBOL}` - Stock data, refreshed on daily update
- `heatmap:all` - Market-wide data (if implemented)

## Security

- **CORS:** Open by default (configure in `src/server.js` for production)
- **Rate limiting:** 100 req/15min global, 30 req/min per stock
- **Input sanitization:** Symbol names filtered to alphanumeric + underscore
- **No secrets in code:** All configs via environment variables

## Scaling Considerations

### Current Capacity
- **Storage:** ~500MB for 500 stocks × 3 years
- **Bandwidth:** ~50KB per API call
- **Daily update time:** ~45 minutes for all 500 stocks

### Scaling to 10k+ requests/day
- ✅ Add Cloudflare (free tier)
- ✅ Enable GitHub Pages CDN (already active)
- ⚠️ NSE scraping may get IP-banned at high volume
- 💡 Consider official data provider (EOD, Alpha Vantage, etc.)

### Alternatives
- **Cloudflare Workers KV** for edge storage
- **Vercel Blob** or **S3** for larger datasets
- **PostgreSQL/TimescaleDB** for advanced queries

## Future Enhancements

- [ ] GraphQL API layer
- [ ] WebSocket for real-time updates
- [ ] Technical indicators (RSI, MACD, etc.)
- [ ] Portfolio tracking module
- [ ] Alert/notification system
- [ ] Mobile app integration
