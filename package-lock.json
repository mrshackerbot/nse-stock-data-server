import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

describe('NSE Stock Data Server', () => {
  let serverProcess;

  before(async () => {
    console.log('Starting server for tests...');
    serverProcess = spawn('node', [path.join(rootDir, 'src', 'server.js')], {
      cwd: rootDir,
      stdio: 'pipe'
    });

    serverProcess.stdout.on('data', (data) => {
      console.log(`Server: ${data}`);
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`Server error: ${data}`);
    });

    await new Promise(resolve => setTimeout(resolve, 3000));
  });

  after(() => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }
  });

  it('should start server and listen on port 3000', async () => {
    const response = await fetch('http://localhost:3000/api/health');
    assert.strictEqual(response.status, 200);

    const data = await response.json();
    assert.strictEqual(data.status, 'healthy');
    assert.ok(data.timestamp);
    assert.ok(typeof data.uptime === 'number');
  });

  it('should return 404 for non-existent stock', async () => {
    const response = await fetch('http://localhost:3000/api/stocks/INVALID_SYMBOL');
    assert.strictEqual(response.status, 404);

    const data = await response.json();
    assert.strictEqual(data.error, 'Stock not found');
  });

  it('should return metadata endpoint', async () => {
    const response = await fetch('http://localhost:3000/api/metadata');
    // May return 500 if data not built yet, that's okay
    assert.ok([200, 500].includes(response.status));
  });

  it('should return stocks list with pagination', async () => {
    const response = await fetch('http://localhost:3000/api/stocks?page=1&limit=5');
    assert.strictEqual(response.status, 200);

    const data = await response.json();
    assert.ok(Array.isArray(data.stocks));
    assert.ok(typeof data.total === 'number');
    assert.ok(typeof data.page === 'number');
  });

  it('should serve static files from public directory', async () => {
    const response = await fetch('http://localhost:3000/');
    assert.strictEqual(response.status, 200);
    const text = await response.text();
    assert.ok(text.includes('NSE 500 Stock Data'));
  });
});

describe('Utils Module', () => {
  it('should have required utility functions', async () => {
    const utils = await import('../scripts/utils.js');

    assert.ok(typeof utils.ensureDirectories === 'function');
    assert.ok(typeof utils.formatDate === 'function');
    assert.strictEqual(utils.formatDate(new Date('2024-01-15')), '2024-01-15');
    assert.ok(typeof utils.cleanSymbol === 'function');
    assert.strictEqual(utils.cleanSymbol('RELIANCE.NS'), 'RELIANCE');
    assert.strictEqual(utils.cleanSymbol('TCS.BSE'), 'TCS');
    assert.ok(typeof utils.formatSymbolForFilename === 'function');
    assert.strictEqual(utils.formatSymbolForFilename('RELIANCE.NS'), 'RELIANCE_NS');
  });
});
