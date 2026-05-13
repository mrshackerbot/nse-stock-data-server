/**
 * NSE Stock Data API - Frontend App
 * Loads statistics and handles client-side interactivity
 */

async function loadStats() {
  try {
    const response = await fetch('/api/metadata');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    const totalStocksEl = document.getElementById('totalStocks');
    const lastUpdateEl = document.getElementById('lastUpdate');
    const dataPointsEl = document.getElementById('dataPoints');

    if (totalStocksEl && data.totalStocks !== undefined) {
      totalStocksEl.textContent = data.totalStocks.toLocaleString();
    }

    if (lastUpdateEl && data.lastUpdated) {
      const date = new Date(data.lastUpdated);
      lastUpdateEl.textContent = date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    }

    if (dataPointsEl && data.dataRange) {
      const startYear = new Date(data.dataRange.start).getFullYear();
      const endYear = new Date(data.dataRange.end).getFullYear();
      const years = endYear - startYear + 1;
      dataPointsEl.textContent = `${years} yr${years !== 1 ? 's' : ''}`;
    }
  } catch (error) {
    console.error('Failed to load stats:', error);

    const totalStocksEl = document.getElementById('totalStocks');
    const lastUpdateEl = document.getElementById('lastUpdate');
    const dataPointsEl = document.getElementById('dataPoints');

    if (totalStocksEl) totalStocksEl.textContent = '--';
    if (lastUpdateEl) lastUpdateEl.textContent = 'N/A';
    if (dataPointsEl) dataPointsEl.textContent = '--';
  }
}

function init() {
  loadStats();

  document.querySelectorAll('pre code').forEach((block) => {
    block.addEventListener('click', async (e) => {
      const text = e.target.textContent.trim();
      if (text) {
        try {
          await navigator.clipboard.writeText(text);
          const original = e.target.style.backgroundColor;
          e.target.style.backgroundColor = '#4a4a4a';
          setTimeout(() => {
            e.target.style.backgroundColor = original;
          }, 200);
        } catch (err) {
          console.error('Failed to copy:', err);
        }
      }
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
