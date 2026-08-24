import express from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs/promises';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { formatSymbolForFilename, cleanSymbol, PUBLIC_DATA_DIR } from '../scripts/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(rootDir, 'public');
const DATA_DIR = path.join(rootDir, 'data', 'stocks');
const LATEST_DIR = path.join(PUBLIC_DATA_DIR, 'latest');

const corsOptions = {
  origin: '*',
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
  maxAge: 86400
};

app.use(cors(corsOptions));
app.use(compression());
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: JSON.stringify({ error: 'Too many requests, please try again later.' }),
  statusCode: 429,
  standardHeaders: true,
  legacyHeaders: false
});

const stockLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: JSON.stringify({ error: 'Too many stock requests, please slow down.' }),
  statusCode: 429
});

app.use('/api/', apiLimiter);
app.use('/api/stocks/', stockLimiter);

app.use(express.static(PUBLIC_DIR, {
  maxAge: '1h',
  etag: true,
  lastModified: true
}));

app.get('/api/stocks', async (req, res) => {
  try {
     const metadataPath = path.join(PUBLIC_DATA_DIR, 'metadata', 'stocksList.json');

    const metadata = JSON.parse(
      await fs.readFile(metadataPath, 'utf8')
    );

    const { symbol, page = 1, limit = 50 } = req.query;
    let stocks = metadata.stocksList || [];

    if (symbol) {
      const searchTerm = symbol.toLowerCase();
      stocks = stocks.filter(s => s.toLowerCase().includes(searchTerm));
    }

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedStocks = stocks.slice(startIndex, endIndex);

    res.json({
      total: stocks.length,
      page: parseInt(page),
      totalPages: Math.ceil(stocks.length / limit),
      lastUpdated: metadata.lastUpdated,
      dataRange: metadata.dataRange,
      stocks: paginatedStocks
    });
  } catch (error) {
    console.error('Error fetching stock list:', error);
    res.status(500).json({ error: 'Failed to fetch stock list' });
  }
});

app.get('/api/stocks/:symbol', async (req, res) => {
     try {
       const { symbol } = req.params;
       const { from, to, limit, format = 'json' } = req.query;

       const cleanSym = cleanSymbol(symbol);
       const symbolDir = path.join(DATA_DIR, cleanSym);

       let exists = false;
       try {
         await fs.access(symbolDir);
         exists = true;
       } catch {
         // Directory doesn't exist
       }

       if (!exists) {
         return res.status(404).json({
           error: 'Stock not found',
           symbol: req.params.symbol,
           available: 'Check /api/stocks for list of available symbols'
         });
       }

       // Read all year files from the symbol directory
       let data = [];
       const yearFiles = await fs.readdir(symbolDir);
       for (const file of yearFiles) {
         if (file.endsWith('.json')) {
           const filePath = path.join(symbolDir, file);
           try {
             const fileData = JSON.parse(await fs.readFile(filePath, 'utf8'));
             data = data.concat(fileData);
           } catch {
             // Skip unreadable files
           }
         }
       }

        // Sort by date
        data.sort((a, b) => new Date(a.date) - new Date(b.date));

        if (from || to) {
          const fromDate = from ? new Date(from) : null;
          const toDate = to ? new Date(to) : null;
          data = data.filter(d => {
            const itemDate = new Date(d.date);
            if (fromDate && itemDate < fromDate) return false;
            if (toDate && itemDate > toDate) return false;
            return true;
          });
        }

        if (limit) data = data.slice(-parseInt(limit));

       res.setHeader('Access-Control-Allow-Origin', '*');
       res.setHeader('Cache-Control', 'public, max-age=3600');

       if (format === 'csv' && data.length > 0) {
         res.setHeader('Content-Type', 'text/csv; charset=utf-8');
         const headers = Object.keys(data[0]).join(',');
         const rows = data.map(row => Object.values(row).join(','));
         res.send([headers, ...rows].join('\n'));
       } else {
         res.setHeader('Content-Type', 'application/json');
         res.json(data);
       }
     } catch (error) {
       console.error(`Error fetching stock ${req.params.symbol}:`, error);
       res.status(500).json({
         error: 'Failed to fetch stock data',
         details: error.message
       });
     }
   });

app.get('/api/metadata', async (req, res) => {
  try {
    const metadataPath = path.join(PUBLIC_DATA_DIR, 'metadata', 'stocksList.json');
    const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8'));
    res.json(metadata);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch metadata' });
  }
});

app.get('/api/latest', async (req, res) => {
  try {
    const { symbol } = req.query;

    if (symbol) {
      const cleanSym = cleanSymbol(symbol);
      const fileName = formatSymbolForFilename(cleanSym) + '.json';
      const filePath = path.join(LATEST_DIR, fileName);

      try {
        const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.json(data);
      } catch {
        return res.status(404).json({
          error: 'Latest data not found for this stock',
          symbol: req.query.symbol
        });
      }
      return;
    }

    // Return all latest files
    let files = [];
    try {
      files = await fs.readdir(LATEST_DIR);
    } catch {
      return res.status(200).json({ latestData: {}, count: 0, message: 'No latest data available' });
    }
    const latestData = {};

    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const data = JSON.parse(await fs.readFile(path.join(LATEST_DIR, file), 'utf8'));
          const sym = file.replace('.json', '');
          latestData[sym] = data;
        } catch {
          // Skip unreadable files
        }
      }
    }

    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(latestData);
  } catch (error) {
    console.error('Error fetching latest data:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch latest data' });
    }
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

const startServer = async () => {
  try {
    await fs.access(PUBLIC_DIR);
    console.log(`Server starting on port ${PORT}...`);
    console.log(`Serving files from: ${PUBLIC_DIR}`);

    app.listen(PORT, () => {
      console.log(`✓ Server running at http://localhost:${PORT}`);
      console.log(`✓ API endpoints:`);
      console.log(`  GET /api/stocks - List all stocks`);
      console.log(`  GET /api/stocks/:symbol?from=&to=&limit=&format= - Get stock data (JSON/CSV)`);
      console.log(`  GET /api/metadata - Get metadata`);
      console.log(`  GET /api/health - Health check`);
      console.log(`  GET /data/:path - Static files`);
      console.log(`\n📋 API docs: http://localhost:${PORT}/`);
    });
  } catch (error) {
    console.error('❌ Public directory not found.');
    console.error('Run `npm run build` first to generate static files.');
    console.error('Or run `npm run fetch-historical` to download data.');
    process.exit(1);
  }
};

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

startServer();
