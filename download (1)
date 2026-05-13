import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import axios from "axios";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

export const DATA_DIR = path.join(rootDir, "data", "stocks");
export const METADATA_DIR = path.join(rootDir, "data", "metadata");
export const PUBLIC_DIR = path.join(rootDir, "public", "data");
export const CACHE_DIR = path.join(rootDir, "data", "cache");

export const CACHE_EXPIRY_HOURS = 24;

export const NSE_HISTORICAL_URL =
  "https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi";

export const NSE_HEADERS = {
  Referer: "https://www.nseindia.com/get-quotes/equity",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

export function getNSEOptionsWithCookies(customHeaders = {}) {
  const headers = {
    ...NSE_HEADERS,
    ...customHeaders,
  };

  if (nseCookieJar && Array.isArray(nseCookieJar)) {
    const cookieHeader = nseCookieJar
      .map((c) => {
        const match = c.match(/^([^=]+)=/);
        return match ? match[1] : null;
      })
      .filter(Boolean)
      .join("; ");

    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }
  }

  return headers;
}

export async function ensureDirectories() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(METADATA_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  await fs.mkdir(path.join(PUBLIC_DIR, "stocks"), { recursive: true });
  await fs.mkdir(path.join(PUBLIC_DIR, "metadata"), { recursive: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.mkdir(path.join(CACHE_DIR, "stocks"), { recursive: true });
  await fs.mkdir(path.join(CACHE_DIR, "heatmap"), { recursive: true });
}

export function formatDate(date) {
  return date.toISOString().split("T")[0];
}

export function getYesterday() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday;
}

export function isMarketClosed() {
  const now = new Date();
  const istTime = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  const hour = istTime.getHours();
  const isWeekday = istTime.getDay() >= 1 && istTime.getDay() <= 5;
  return isWeekday && hour >= 16;
}

export function cleanSymbol(symbol) {
  return symbol.replace(".NS", "").replace(".BSE", "").toUpperCase();
}

export function formatSymbolForFilename(symbol) {
  return symbol.replace(/[^a-zA-Z0-9]/g, "_");
}

export function parseCSVLine(line) {
  return line.split(/","/).map((c) => c.replace(/^"|"$/g, "").trim());
}

export async function copyToPublic() {
  try {
    await fs.cp(DATA_DIR, path.join(PUBLIC_DIR, "stocks"), {
      recursive: true,
      force: true,
    });
    await fs.cp(METADATA_DIR, path.join(PUBLIC_DIR, "metadata"), {
      recursive: true,
      force: true,
    });
    console.log("✓ Data copied to public folder");
  } catch (error) {
    console.error("Failed to copy data to public:", error.message);
  }
}

export function getSymbolDir(symbol) {
   const cleanSym = cleanSymbol(symbol);
   return path.join(DATA_DIR, cleanSym);
 }

export function ensureDir(dir) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

export function saveCache(type, key, data) {
   const dir = path.join(CACHE_DIR, type);
   ensureDir(dir);
   const file = path.join(dir, `${key}.json`);
   const cacheData = {
     data,
     timestamp: Date.now(),
   };
   writeFileSync(file, JSON.stringify(cacheData, null, 2));
   log(`Cache saved: ${type}/${key}`);
}

  export function loadCache(type, key) {
    const file = path.join(CACHE_DIR, type, `${key}.json`);
    if (!existsSync(file)) {
      return null;
    }
    try {
      const cacheData = JSON.parse(readFileSync(file, "utf8"));
    const ageHours = (Date.now() - cacheData.timestamp) / (1000 * 60 * 60);
    if (ageHours > CACHE_EXPIRY_HOURS) {
      log(`Cache expired: ${type}/${key} (${ageHours.toFixed(1)}h old)`);
      return null;
    }
    log(`Cache hit: ${type}/${key} (${ageHours.toFixed(1)}h old)`);
    return cacheData.data;
  } catch (err) {
    log(`Cache error for ${type}/${key}: ${err.message}`);
    return null;
  }
}

export function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

export async function readStockList() {
  const filePath = path.join(METADATA_DIR, "stocksList.json");
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch {
    return { stocksList: [], lastUpdated: null, totalStocks: 0 };
  }
}

export function isValidDate(dateString) {
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

// Fallback symbol list (used if NSE API is unavailable)
export function getFallbackSymbols() {
  return [
    "RELIANCE",
    "TCS",
    "HDFCBANK",
    "INFY",
    "HINDUNILVR",
    "ICICIBANK",
    "KOTAKBANK",
    "SBIN",
    "BHARTIARTL",
    "ITC",
    "ASIANPAINT",
    "MARUTI",
    "AXISBANK",
    "LT",
    "WIPRO",
    "BAJFINANCE",
    "HCLTECH",
    "SUNPHARMA",
    "TITAN",
    "ULTRACEMCO",
    "NTPC",
    "TATAMOTORS",
    "TECHM",
    "M&M",
    "POWERGRID",
    "GRASIM",
    "NESTLEIND",
    "JSWSTEEL",
    "BAJAJFINSV",
    "TATACONSUM",
    "ADANIENT",
    "DIVISLAB",
    "SBILIFE",
    "DRREDDY",
    "HDFCLIFE",
    "BAJAJ-AUTO",
    "EICHERMOT",
    "COALINDIA",
    "BPCL",
    "UPL",
    "HEROMOTOCO",
    "ONGC",
    "APOLLOHOSP",
    "CIPLA",
    "DABUR",
    "GODREJCP",
    "HAVELLS",
    "HDFCAMC",
    "ICICIPRULI",
    "INDUSINDBK",
    "PFC",
    "RECLTD",
    "SIEMENS",
    "TATAPOWER",
    "BRITANNIA",
    "TORNTPHARM",
    "AUROPHARMA",
    "FEDERALBNK",
    "CANBK",
    "BANDHANBNK",
    "IDFCFIRSTB",
    "IDEA",
    "BANKBARODA",
    "PNB",
    "UNIONBANK",
    "IOB",
    "BANKINDIA",
    "UCOBANK",
    "BOB",
    "NHPC",
    "PGCIL",
    "POWERINDIA",
    "NLCINDIA",
    "GAIL",
    "IOC",
    "MRPL",
    "HINDPETRO",
    "PETRONET",
    "TATACHEM",
    "JINDALSTEL",
    "JSWENERGY",
    "ADANIPOWER",
    "SJVN",
    "HUDCO",
    "IRCON",
    "RITES",
    "IRCTC",
    "CONCOR",
    "SCI",
    "HAL",
    "BEL",
    "BDL",
    "BEML",
    "GRSE",
    "MAZAGON",
    "COCHINSHIP",
    "MIDHANI",
    "ACC",
    "AMBUJACEM",
    "SHREECEM",
  ];
}

export const NSE_INDICES_URL = 'https://www.nseindia.com/api/NextApi/apiClient/indexTrackerApi';

export async function getNSE500Symbols(useCache = true) {
  if (useCache) {
    const cached = loadCache("system", "nse_500_symbols");
    if (cached && Array.isArray(cached) && cached.length > 0) {
      log("Using cached NSE 500 symbols list");
      return cached;
    }
  }

  try {
    log("Fetching NSE 500 symbols from NSE India...");

    const cookieRes = await axios.get('https://www.nseindia.com/', {
      headers: { 'User-Agent': NSE_HEADERS['User-Agent'] },
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: (s) => s < 400,
    });

    const cookies = cookieRes.headers['set-cookie'] || [];
    const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

    const response = await axios.get(NSE_INDICES_URL, {
      params: { functionName: 'getAllIndicesSymbols', index: 'NIFTY 500' },
      headers: {
        ...NSE_HEADERS,
        Cookie: cookieHeader,
        Accept: 'application/json',
      },
      timeout: 30000,
    });

    const data = response.data;
    let symbols = [];

    if (data && Array.isArray(data.data)) {
      symbols = data.data;
    }

    // Clean symbols
    symbols = [...new Set(symbols.map(s => s.replace('.NS', '').replace('.BSE', '').toUpperCase()))];

    if (symbols.length === 0) {
      throw new Error("No symbols returned");
    }

    saveCache("system", "nse_500_symbols", symbols);
    log(`Fetched ${symbols.length} symbols from NSE`);
    return symbols;
  } catch (error) {
    console.error("Failed to fetch NSE 500 symbols:", error.message);
    log("Using fallback NSE 100 list");
    return getFallbackSymbols();
  }
}
