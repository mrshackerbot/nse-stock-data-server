import fs from 'fs/promises';
import path from 'path';
import { ensureDirectories, DATA_DIR, LATEST_DIR, METADATA_DIR, PUBLIC_DIR, PUBLIC_DATA_DIR, copyToPublic, readStockList, log } from './utils.js';

async function buildStaticSite() {
  log('Building static site for GitHub Pages...');
  await ensureDirectories();

  const metadata = await readStockList();
  if (metadata.stocksList.length === 0) {
    log('No stock data found. Please run fetch-historical first.');
    process.exit(1);
  }

  const stocks = metadata.stocksList;
  log(`Processing ${stocks.length} stocks...`);

  let successCount = 0;
  let errorCount = 0;

  // Build flat JSON files from year subdirectories
  for (let i = 0; i < stocks.length; i++) {
    const symbol = stocks[i];
    const cleanSym = symbol.replace(/[^a-zA-Z0-9]/g, '_');
    const symbolDir = path.join(DATA_DIR, cleanSym);
    const destPath = path.join(PUBLIC_DATA_DIR, 'stocks', `${cleanSym}.json`);

    try {
      const yearFiles = await fs.readdir(symbolDir);
      let allData = [];

      for (const file of yearFiles) {
        if (file.endsWith('.json')) {
          const filePath = path.join(symbolDir, file);
          const fileData = JSON.parse(await fs.readFile(filePath, 'utf8'));
          allData = allData.concat(fileData);
        }
      }

      allData.sort((a, b) => new Date(a.date) - new Date(b.date));

      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, JSON.stringify(allData, null, 2));
      successCount++;
    } catch (err) {
      log(`✗ Error processing ${symbol}: ${err.message}`);
      errorCount++;
    }

    if ((i + 1) % 50 === 0) {
      log(`Processed ${i + 1}/${stocks.length} stocks...`);
    }
  }

  // Copy metadata to public
  await fs.cp(METADATA_DIR, path.join(PUBLIC_DATA_DIR, 'metadata'), {
    recursive: true,
    force: true
  });

  // Generate latest data files (one per stock, containing the most recent record)
  await fs.mkdir(path.join(PUBLIC_DATA_DIR, 'latest'), { recursive: true });
  let latestSuccessCount = 0;
  for (const symbol of stocks) {
    const cleanSym = symbol.replace(/[^a-zA-Z0-9]/g, '_');
    const symbolDir = path.join(DATA_DIR, cleanSym);
    try {
      const yearFiles = await fs.readdir(symbolDir);
      let allData = [];
      for (const file of yearFiles) {
        if (file.endsWith('.json')) {
          const fileData = JSON.parse(await fs.readFile(path.join(symbolDir, file), 'utf8'));
          allData = allData.concat(fileData);
        }
      }
      if (allData.length > 0) {
        allData.sort((a, b) => new Date(a.date) - new Date(b.date));
        const latestRecord = allData[allData.length - 1];
        await fs.writeFile(
          path.join(PUBLIC_DATA_DIR, 'latest', `${cleanSym}.json`),
          JSON.stringify(latestRecord, null, 2)
        );
        latestSuccessCount++;
      }
    } catch (err) {
      log(`✗ Error building latest for ${symbol}: ${err.message}`);
    }
  }

  // Also copy data/latest to public data/latest
  await copyToPublic();

  log(`\n✅ Build complete!`);
  log(`  ✓ Success: ${successCount} stocks`);
  log(`  ✓ Latest files: ${latestSuccessCount}`);
  log(`  ✗ Errors: ${errorCount} stocks`);
  log(`\nStatic files ready at: ${PUBLIC_DIR}`);
  log(`Deploy the 'public' folder to GitHub Pages`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildStaticSite().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}

export { buildStaticSite };
