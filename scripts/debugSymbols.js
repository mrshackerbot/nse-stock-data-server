import axios from 'axios';

const NSE_INDICES_URL = 'https://www.nseindia.com/api/NextApi/apiClient/indexTrackerApi';
const NSE_HEADERS = {
  Referer: 'https://www.nseindia.com/market-data/top-gainers',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

async function testSymbols() {
  try {
    const cookieRes = await axios.get('https://www.nseindia.com/', {
      headers: { 'User-Agent': NSE_HEADERS['User-Agent'] },
      timeout: 10000,
    });

    const cookies = cookieRes.headers['set-cookie'] || [];
    const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

    console.log('Cookies:', cookieHeader.substring(0, 100));

    const res = await axios.get(NSE_INDICES_URL, {
      params: { functionName: 'getAllIndicesSymbols', index: 'NIFTY 500' },
      headers: {
        ...NSE_HEADERS,
        Cookie: cookieHeader,
      },
      timeout: 30000,
    });

    console.log('Status:', res.status);
    console.log('Keys:', Object.keys(res.data));
    console.log('Data sample:', JSON.stringify(res.data).substring(0, 500));
  } catch (e) {
    console.error('Error:', e.message);
    if (e.response) {
      console.log('Response status:', e.response.status);
      console.log('Response data:', JSON.stringify(e.response.data).substring(0, 500));
    }
  }
}

testSymbols();
