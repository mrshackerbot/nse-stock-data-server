#!/usr/bin/env node

/**
 * Setup script - validates environment and creates necessary directories
 * Run: node scripts/setup.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const requiredDirs = [
  'data/stocks',
  'data/metadata',
  'data/cache/stocks',
  'data/cache/heatmap',
  'public/data/stocks',
  'public/data/metadata',
  'public/.nojekyll'
];

async function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major < 18) {
    console.error(`❌ Node.js 18+ required. Current: ${version}`);
    process.exit(1);
  }
  console.log(`✓ Node.js ${version} detected`);
}

async function ensureDirectories() {
  console.log('\n📁 Creating directory structure...');
  for (const dir of requiredDirs) {
    const fullPath = path.join(rootDir, dir);
    await fs.mkdir(fullPath, { recursive: true });
    console.log(`  ✓ ${dir}`);
  }
}

async function checkDependencies() {
  console.log('\n📦 Checking dependencies...');
  try {
    await fs.access(path.join(rootDir, 'node_modules'));
    console.log('  ✓ node_modules installed');
  } catch {
    console.log('  ⚠ node_modules not found. Run: npm install');
  }
}

async function validateConfig() {
  console.log('\n🔧 Validating configuration...');

  try {
    const packageJson = await import(path.join(rootDir, 'package.json'));
    console.log(`  ✓ Project: ${packageJson.name || 'nse-stock-data-server'}`);
    console.log(`  ✓ Version: ${packageJson.version || '1.0.0'}`);
  } catch (error) {
    console.error('  ❌ package.json not found or invalid');
    return false;
  }

  return true;
}

async function runSetup() {
  console.log('🚀 Setting up NSE Stock Data Server...\n');

  await checkNodeVersion();
  const configValid = await validateConfig();
  await ensureDirectories();
  await checkDependencies();

  console.log('\n✅ Setup complete!');
  console.log('\n📋 Next steps:');
  console.log('  1. npm install              # Install dependencies (if not done)');
  console.log('  2. npm run fetch-sample     # Test with 5 sample stocks');
  console.log('  3. npm run build            # Build static files');
  console.log('  4. npm start                # Start the server');
  console.log('  5. Open http://localhost:3000\n');

  console.log('💡 For production with full dataset:');
  console.log('  npm run fetch-historical    # Fetch all 500 stocks (takes hours)');
  console.log('\n');
}

runSetup().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
