# NSE 500 Stock Data Server

A Node.js server that fetches, stores, and serves historical stock data for NSE 500 companies. Data is served as JSON or CSV via a REST API and can be deployed to GitHub Pages for free static hosting.

## Features

- 📊 **3+ years historical data** for NSE 500 stocks
- 🔄 **Daily updates** after market close (4:00 PM IST)
- 📡 **REST API** with JSON/CSV output support
- 🌐 **CORS enabled** for client-side applications
- 💾 **Smart caching** system with stale-while-revalidate
- 🚀 **GitHub Pages ready** - zero-cost hosting
- ⚡ **Express.js server** with compression middleware
- 📁 **Clean folder structure** for maintainability

## Project Structure

```
nse-stock-data-server/
├── src/
│   └── server.js           # Express server with API endpoints
├── scripts/
│   ├── fetchHistorical.js  # Fetch 3 years of historical data
│   ├── updateDaily.js      # Append new daily data
│   ├── build.js            # Build static files for GitHub Pages
│   └── utils.js            # Shared utilities
├── data/
│   ├── stocks/             # Individual stock JSON files
│   ├── metadata/           # stocksList.json, cache info
│   └── cache/              # Cached API responses
├── public/
│   ├── index.html          # API documentation page
│   ├── .nojekyll           # Disable Jekyll processing
│   └── data/
│       ├── stocks/         # Static JSON files for GitHub Pages
│       └── metadata/
├── tests/                  # Test files
├── .github/
│   └── workflows/
│       ├── fetch-historical.yml
│       └── daily-update.yml
├── package.json
├── .env.example
└── README.md
```

## Quick Start

### 1. Installation

```bash
npm install
```

### 2. Fetch Sample Data (5 stocks)

Quick test to verify everything works:

```bash
npm run fetch-sample
```

### 3. Fetch Full Historical Data (NSE 500)

```bash
# Fetch all 500 stocks (takes several hours due to rate limits)
npm run fetch-historical

# Or test with a smaller batch first
node scripts/fetchHistorical.js 10
```

### 4. Build Static Files

```bash
npm run build
```

### 5. Start the Server

```bash
npm start
# Server runs at http://localhost:3000
```

### 6. Visit API Documentation

Open http://localhost:3000 in your browser.

## API Endpoints

### GET /api/stocks
List all available stocks with pagination.

**Query Parameters:**
- `symbol` (string) - Filter by symbol (case-insensitive)
- `page` (number) - Page number (default: 1)
- `limit` (number) - Items per page (default: 50, max: 500)

**Example:**
```
GET /api/stocks?page=1&limit=100&symbol=RELIANCE
```

### GET /api/stocks/:symbol
Get historical data for a specific stock symbol.

**Query Parameters:**
- `from` (date) - Start date (YYYY-MM-DD)
- `to` (date) - End date (YYYY-MM-DD)
- `limit` (number) - Limit to last N days
- `format` (string) - Response format: `json` or `csv`

**Examples:**
```
GET /api/stocks/RELIANCE?limit=30&format=json
GET /api/stocks/TCS?from=2024-01-01&to=2024-12-31&format=csv
```

### GET /api/metadata
Get metadata including stock list and data range.

**Example:**
```json
{
  "lastUpdated": "2024-01-15T10:30:00.000Z",
  "totalStocks": 500,
  "stocksList": ["RELIANCE.NS", "TCS.NS", ...],
  "dataRange": {
    "start": "2021-01-01",
    "end": "2024-01-15"
  }
}
```

### GET /api/health
Health check endpoint.

**Example:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600.5
}
```

## Data Format

Each stock's data is an array of daily OHLCV records:

```json
[
  {
    "date": "2024-01-15",
    "open": 2850.50,
    "high": 2875.30,
    "low": 2840.00,
    "close": 2865.75,
    "volume": 2456789,
    "symbol": "RELIANCE"
  }
]
```

## GitHub Pages Deployment

### Setup

1. **Create a GitHub repository** and push your code:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/nse-stock-data.git
git push -u origin main
```

2. **Enable GitHub Pages**:
   - Go to Settings → Pages
   - Source: "Deploy from branch"
   - Branch: `main` → `/public` folder

3. **Your API will be available at**:
```
https://yourusername.github.io/nse-stock-data/
```

### Automated Updates with GitHub Actions

The repository includes two GitHub Actions workflows:

- **`.github/workflows/fetch-historical.yml`** - Manual trigger for initial data fetch
- **`.github/workflows/daily-update.yml`** - Runs automatically Mon-Fri at 4:00 PM IST

These workflows will:
1. Checkout your repository
2. Install dependencies
3. Run the update scripts
4. Commit and push updated data to GitHub Pages

**Note:** NSE India has rate limits. The scripts include delays to avoid IP blocking.

## Local Development

```bash
# Install dependencies
npm install

# Run server with auto-reload
npm run dev

# Fetch test data (10 stocks)
node scripts/fetchHistorical.js 10

# Update daily data
npm run update-daily

# Build static site for GitHub Pages
npm run build
```

## Tests

```bash
npm test
```

## Environment Variables

Create a `.env` file in the root directory (optional):

```env
PORT=3000
NODE_ENV=production
```

## Data Source

This project fetches data directly from **NSE India's** historical data API:

- 🔄 **Direct NSE integration** - No third-party APIs
- 📈 **Accurate data** - Sourced from NSE's official endpoint
- ⚡ **Comprehensive** - All NSE 500 stocks with OHLCV + volume
- ⚠️ **Rate limit aware** - Built-in delays and retry logic

**Symbol format:** Use clean symbol names (without exchange suffix)  
Example: `RELIANCE`, `TCS`, `HDFCBANK` (not `RELIANCE.NS`)

The API endpoint used:
```
https://www.nseindia.com/api/historical/securities-wise-historical-data
```

**Important:** NSE India implements strict rate limiting. The scripts include:
- 2-3 second delays between requests
- Automatic retry on rate limit (429) with 30s backoff
- Caching to minimize repeat requests

### NSE India Rate Limits
- NSE India does not publish official rate limits for their historical data API
- The API is rate-limited per IP address; excessive requests may result in temporary blocks
- Scripts include 2-3 second delays between requests to avoid hitting limits
- On rate limit (429), scripts automatically wait 30 seconds and retry

### GitHub Pages Limits
- **Bandwidth:** 100 GB/month (soft limit)
- **File size:** Max 100 MB per file
- **Repo size:** Recommended 1 GB, hard limit 100 GB

For a typical NSE 500 project (~500MB of data), you're well within limits unless you get millions of requests per month.

## CSV Export

The API supports CSV format natively:

```
GET /api/stocks/RELIANCE?format=csv
```

Returns:
```
date,open,high,low,close,volume,symbol
2024-01-15,2850.50,2875.30,2840.00,2865.75,2456789,RELIANCE
...
...
```

## JavaScript Example

```javascript
async function getStockData(symbol, options = {}) {
  const params = new URLSearchParams({
    limit: options.limit || 100,
    format: options.format || 'json'
  });

  if (options.from) params.append('from', options.from);
  if (options.to) params.append('to', options.to);

  const response = await fetch(
    `http://localhost:3000/api/stocks/${symbol}?${params}`
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return options.format === 'csv'
    ? await response.text()
    : await response.json();
}

// Usage examples
const relianceData = await getStockData('RELIANCE', { limit: 30 });
console.log(relianceData.slice(-5)); // Last 5 trading days

const tcsCSV = await getStockData('TCS', {
  from: '2024-01-01',
  to: '2024-12-31',
  format: 'csv'
});
console.log(tcsCSV);
```

## CORS Configuration

The server enables CORS for all origins by default for simplicity. To restrict access:

Edit `src/server.js` and modify the CORS configuration:

```javascript
const corsOptions = {
  origin: ['https://yourdomain.com', 'https://app.yourdomain.com'],
  methods: ['GET'],
  maxAge: 86400
};
app.use(cors(corsOptions));
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see LICENSE file for details.

## Disclaimer

This project is for educational and personal use. NSE India data is sourced from public endpoints. Respect NSE's terms of service and rate limits. The maintainers are not responsible for any misuse or IP blocking.

## Credits

Built with:
- [Express.js](https://expressjs.com/) - Web framework
- [Axios](https://axios-http.com/) - HTTP client
- [GitHub Pages](https://pages.github.com/) - Free hosting
- [NSE India](https://www.nseindia.com/) - Data source
