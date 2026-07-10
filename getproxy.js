const axios = require('axios');
const fs = require('fs');
const path = require('path');

const PROXY_URLS = [
  'https://api.proxyscrape.com/?request=displayproxies&proxytype=http',
  'https://proxyspace.pro/http.txt',
  'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
  'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt',
];

const PROXY_FILE = process.argv[2] || 'proxy.txt';

async function downloadProxiesFromURL(url) {
  try {
    const { data } = await axios.get(url, { timeout: 15000 });
    return data;
  } catch (error) {
    console.error(`[!] Failed to download from ${url}: ${error.message}`);
    return '';
  }
}

async function downloadProxies() {
  console.log('[+] Fetching proxies from multiple sources...');
  
  const results = await Promise.allSettled(PROXY_URLS.map(downloadProxiesFromURL));
  const allProxies = results
    .map(r => r.status === 'fulfilled' ? r.value : '')
    .filter(Boolean)
    .join('\n')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i) // deduplicate
    .join('\n');

  if (allProxies) {
    fs.writeFileSync(PROXY_FILE, allProxies);
    const count = allProxies.split('\n').length;
    console.log(`[+] ${count} unique proxies written to ${PROXY_FILE}`);
  } else {
    console.error('[!] No proxies were downloaded.');
    process.exit(1);
  }
}

downloadProxies().catch(err => {
  console.error('[!] Fatal error:', err.message);
  process.exit(1);
});
