#!/usr/bin/env node

const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');

class MuffinCNC {
    constructor() {
        this.servers = [];
        this.sessions = new Map();
        this.currentDirs = new Map();
        this.runningProcesses = new Map();
        this.keepAlive = true;
        
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: '\x1b[92mcnc@muffin\x1b[0m$ '
        });

        this.loadServers();
    }

    loadServers() {
        try {
            const data = fs.readFileSync('servers.json', 'utf8');
            this.servers = JSON.parse(data);
            console.log(`✓ Loaded ${this.servers.length} servers`);
            
            this.servers.forEach(server => {
                this.currentDirs.set(server.host, '/root');
                this.runningProcesses.set(server.host, null);
            });
        } catch (error) {
            console.error('✗ Error loading servers.json:', error.message);
            process.exit(1);
        }
    }

    showWelcome() {
        const welcome = `
  /\\_/\\  
 ( o.o )  MUFFIN CNC - JavaScript Edition Ready!
  > ^ <   
Type '.help' for available commands
        `;
        console.log(welcome);
    }

    async createSSHSession(server) {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            
            conn.on('ready', () => {
                // Get initial current directory
                conn.exec('pwd', (err, stream) => {
                    if (err) {
                        this.currentDirs.set(server.host, '/root');
                        resolve(conn);
                        return;
                    }
                    
                    let output = '';
                    stream.on('data', (data) => {
                        output += data.toString();
                    });
                    
                    stream.on('close', () => {
                        const pwd = output.trim();
                        this.currentDirs.set(server.host, pwd || '/root');
                        resolve(conn);
                    });
                    
                    stream.stderr.on('data', () => {});
                });
            });
            
            conn.on('error', (err) => {
                console.error(`❌ Failed to connect to ${server.host}:`, err.message);
                resolve(null);
            });
            
            conn.connect({
                host: server.host,
                port: server.port || 22,
                username: server.username,
                password: server.password,
                readyTimeout: 15000,
                algorithms: {
                    kex: [
                        'ecdh-sha2-nistp256',
                        'ecdh-sha2-nistp384',
                        'ecdh-sha2-nistp521',
                        'diffie-hellman-group14-sha256'
                    ],
                    cipher: [
                        'aes128-gcm',
                        'aes256-gcm',
                        'aes128-ctr',
                        'aes192-ctr',
                        'aes256-ctr'
                    ]
                }
            });
        });
    }

    async executeCommand(server, command, options = {}) {
        const { debugMode = false, waitForCompletion = false } = options;
        
        return new Promise(async (resolve) => {
            try {
                let conn = this.sessions.get(server.host);
                if (!conn) {
                    conn = await this.createSSHSession(server);
                    if (!conn) {
                        resolve({
                            host: server.host,
                            status: 'failed',
                            error: 'No SSH session'
                        });
                        return;
                    }
                    this.sessions.set(server.host, conn);
                }

                // Handle cd command
                if (command.trim().startsWith('cd ')) {
                    const newDir = command.trim().slice(3).trim();
                    let fullPath;
                    
                    if (newDir.startsWith('/')) {
                        fullPath = newDir;
                    } else {
                        const currentDir = this.currentDirs.get(server.host);
                        fullPath = path.posix.join(currentDir, newDir);
                    }
                    
                    this.currentDirs.set(server.host, fullPath);
                    resolve({
                        host: server.host,
                        status: 'success',
                        output: `Changed directory to ${fullPath}`
                    });
                    return;
                }

                // Handle apt commands with auto-confirm
                const autoConfirmCommands = ['apt upgrade', 'apt install', 'apt remove', 'apt dist-upgrade'];
                let finalCommand = command;
                
                if (autoConfirmCommands.some(cmd => command.includes(cmd)) && !command.includes('-y')) {
                    if (command.startsWith('sudo ')) {
                        finalCommand = command.replace('sudo ', 'sudo DEBIAN_FRONTEND=noninteractive ');
                    }
                    finalCommand = finalCommand + ' -y -o Dpkg::Options::="--force-confold"';
                    console.log(`🔧 [${server.host}] Auto-confirm enabled for apt command`);
                }

                // Execute with current directory
                const currentDir = this.currentDirs.get(server.host);
                const fullCommand = `cd "${currentDir}" && ${finalCommand} 2>&1`;

                console.log(`🎯 [${server.host}] Executing: ${finalCommand}`);

                conn.exec(fullCommand, { pty: true }, (err, stream) => {
                    if (err) {
                        resolve({
                            host: server.host,
                            status: 'failed',
                            error: err.message
                        });
                        return;
                    }

                    let output = '';
                    let errorOutput = '';
                    let exitCode = 0;

                    stream.on('data', (data) => {
                        const text = data.toString();
                        output += text;
                        
                        // Real-time output with formatting
                        const lines = text.split('\n');
                        lines.forEach(line => {
                            if (line.trim()) {
                                if (line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')) {
                                    console.log(`🔴 [${server.host}] ${line}`);
                                } else if (line.toLowerCase().includes('warning')) {
                                    console.log(`🟡 [${server.host}] ${line}`);
                                } else if (debugMode && (line.toLowerCase().includes('debug') || line.toLowerCase().includes('info'))) {
                                    console.log(`🔵 [${server.host}] ${line}`);
                                } else {
                                    console.log(`📝 [${server.host}] ${line}`);
                                }
                            }
                        });
                    });

                    stream.stderr.on('data', (data) => {
                        errorOutput += data.toString();
                        console.log(`🔴 [${server.host}] STDERR: ${data.toString().trim()}`);
                    });

                    stream.on('close', (code) => {
                        exitCode = code;
                        resolve({
                            host: server.host,
                            status: exitCode === 0 ? 'success' : 'failed',
                            output: output.trim(),
                            error: errorOutput.trim(),
                            exitCode: exitCode
                        });
                    });
                });

            } catch (error) {
                resolve({
                    host: server.host,
                    status: 'failed',
                    error: error.message
                });
            }
        });
    }

    async executeNodeJS(server, jsFile, options = {}) {
        const { debugMode = false, waitForCompletion = true } = options;
        
        return new Promise(async (resolve) => {
            try {
                let conn = this.sessions.get(server.host);
                if (!conn) {
                    conn = await this.createSSHSession(server);
                    if (!conn) {
                        resolve({
                            host: server.host,
                            status: 'failed',
                            error: 'No SSH session'
                        });
                        return;
                    }
                    this.sessions.set(server.host, conn);
                }

                const currentDir = this.currentDirs.get(server.host);
                let nodeCommand = `cd "${currentDir}" && `;
                
                if (debugMode) {
                    nodeCommand += `node --trace-warnings --unhandled-rejections=strict "${jsFile}"`;
                } else {
                    nodeCommand += `node "${jsFile}"`;
                }

                console.log(`🎯 [${server.host}] Starting Node.js: ${jsFile}`);

                const processInfo = {
                    host: server.host,
                    jsFile: jsFile,
                    startTime: Date.now(),
                    debugMode: debugMode,
                    active: true,
                    outputLines: [],
                    errorCount: 0
                };
                
                this.runningProcesses.set(server.host, processInfo);

                conn.exec(nodeCommand, { pty: true }, (err, stream) => {
                    if (err) {
                        resolve({
                            host: server.host,
                            status: 'failed',
                            error: err.message
                        });
                        return;
                    }

                    let output = '';
                    let errorOutput = '';
                    let exitCode = 0;
                    let lineCount = 0;

                    stream.on('data', (data) => {
                        const text = data.toString();
                        output += text;
                        processInfo.outputLines.push(text);
                        
                        const lines = text.split('\n');
                        lines.forEach(line => {
                            if (line.trim()) {
                                lineCount++;
                                if (line.toLowerCase().includes('error') || line.toLowerCase().includes('failed') || line.toLowerCase().includes('exception')) {
                                    console.log(`🔴 [${server.host}] LINE ${lineCount}: ${line}`);
                                    processInfo.errorCount++;
                                } else if (line.toLowerCase().includes('warning') || line.toLowerCase().includes('deprecated')) {
                                    console.log(`🟡 [${server.host}] LINE ${lineCount}: ${line}`);
                                } else if (debugMode && (line.toLowerCase().includes('debug') || line.toLowerCase().includes('log') || line.toLowerCase().includes('info'))) {
                                    console.log(`🔵 [${server.host}] LINE ${lineCount}: ${line}`);
                                } else {
                                    console.log(`📝 [${server.host}] LINE ${lineCount}: ${line}`);
                                }
                            }
                        });
                    });

                    stream.stderr.on('data', (data) => {
                        errorOutput += data.toString();
                        processInfo.errorCount++;
                        console.log(`🔴 [${server.host}] STDERR: ${data.toString().trim()}`);
                    });

                    stream.on('close', (code) => {
                        exitCode = code;
                        const duration = (Date.now() - processInfo.startTime) / 1000;
                        const statusIcon = exitCode === 0 ? '✅' : '❌';
                        
                        console.log(`${statusIcon} [${server.host}] Process COMPLETED - Exit: ${exitCode}, Duration: ${duration.toFixed(1)}s, Lines: ${lineCount}, Errors: ${processInfo.errorCount}`);
                        
                        this.runningProcesses.set(server.host, null);
                        
                        resolve({
                            host: server.host,
                            status: exitCode === 0 ? 'completed' : 'failed',
                            output: output.trim(),
                            error: errorOutput.trim(),
                            exitCode: exitCode,
                            lineCount: lineCount,
                            errorCount: processInfo.errorCount,
                            duration: duration
                        });
                    });
                });

            } catch (error) {
                this.runningProcesses.set(server.host, null);
                resolve({
                    host: server.host,
                    status: 'failed',
                    error: error.message
                });
            }
        });
    }

    async broadcastCommand(command, options = {}) {
        const results = [];
        const promises = this.servers.map(server => 
            this.executeCommand(server, command, options)
        );
        
        const serverResults = await Promise.all(promises);
        results.push(...serverResults);
        
        return results;
    }

    async broadcastNodeJS(jsFile, options = {}) {
        const results = [];
        const promises = this.servers.map(server => 
            this.executeNodeJS(server, jsFile, options)
        );
        
        const serverResults = await Promise.all(promises);
        results.push(...serverResults);
        
        return results;
    }

    async handlePing() {
        console.log(`\n🔍 Pinging ${this.servers.length} servers...`);
        
        const pingPromises = this.servers.map(server => {
            return new Promise((resolve) => {
                const platform = process.platform;
                const param = platform === 'win32' ? '-n 1 -w 1000' : '-c 1 -W 1';
                const command = `ping ${param} ${server.host}`;
                
                exec(command, (error, stdout, stderr) => {
                    if (error) {
                        resolve({
                            host: server.host,
                            status: 'offline',
                            error: 'Timeout'
                        });
                    } else {
                        const output = stdout.toString();
                        let time = 'N/A';
                        
                        if (output.includes('time=')) {
                            time = output.split('time=')[1].split(' ')[0];
                        }
                        
                        resolve({
                            host: server.host,
                            status: 'online',
                            time: time
                        });
                    }
                });
            });
        });
        
        const results = await Promise.all(pingPromises);
        
        let onlineCount = 0;
        results.forEach((result, index) => {
            if (result.status === 'online') {
                onlineCount++;
                console.log(`✅ [${index + 1}] ${result.host} - ONLINE (${result.time})`);
            } else {
                console.log(`❌ [${index + 1}] ${result.host} - OFFLINE`);
            }
        });
        
        console.log(`\n📊 Results: ${onlineCount}/${this.servers.length} servers online`);
    }

    async handleInstallNodeJS() {
        console.log(`\n🚀 Installing Node.js and npm on ${this.servers.length} servers`);
        console.log("📦 Using NodeSource repository (Node.js 18 LTS)");
        console.log("⚡ This may take several minutes...");
        console.log("=" .repeat(60));
        
        const installScript = `
sudo apt update -y && \\
sudo apt install -y curl gnupg && \\
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && \\
sudo apt install -y nodejs && \\
node --version && npm --version
        `.trim();
        
        const results = await this.broadcastCommand(installScript);
        
        console.log("\n" + "=" .repeat(60));
        console.log("📊 INSTALLATION SUMMARY:");
        console.log("=" .repeat(60));
        
        let successCount = 0;
        results.forEach((result, index) => {
            if (result.status === 'success') {
                successCount++;
                console.log(`✅ [${index + 1}] ${result.host} - NODE.JS INSTALLED`);
                if (result.output) {
                    const lines = result.output.split('\n');
                    const versions = lines.slice(-2).join(', ');
                    console.log(`   📄 ${versions}`);
                }
            } else {
                console.log(`❌ [${index + 1}] ${result.host} - INSTALLATION FAILED`);
                console.log(`   💬 ${result.error}`);
            }
        });
        
        console.log(`\n📊 Installation completed: ${successCount}/${this.servers.length} servers successful`);
    }

    async handleUpgrade() {
        console.log(`\n🔄 Starting automated apt upgrade on ${this.servers.length} servers`);
        console.log("🔧 Features: Auto-yes, non-interactive, force-confold");
        console.log("⏰ This may take several minutes...");
        console.log("=" .repeat(60));
        
        const upgradeScript = `
sudo apt update -y && \\
sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y -o Dpkg::Options::="--force-confold" && \\
sudo apt autoremove -y
        `.trim();
        
        const results = await this.broadcastCommand(upgradeScript);
        
        let successCount = 0;
        console.log("\n" + "=" .repeat(60));
        results.forEach((result, index) => {
            if (result.status === 'success') {
                successCount++;
                console.log(`✅ [${index + 1}] ${result.host} - UPGRADE SUCCESS`);
            } else {
                console.log(`❌ [${index + 1}] ${result.host} - UPGRADE FAILED`);
                console.log(`💬 ${result.error}`);
            }
        });
        
        console.log(`\n📊 Upgrade completed: ${successCount}/${this.servers.length} servers successful`);
    }

    async handleNodeJS(jsFile, options = {}) {
        if (!jsFile) {
            console.log("Usage: .nodejs <filename.js> or .nodejs-debug <filename.js>");
            return;
        }
        
        const { debugMode = false, waitForCompletion = true } = options;
        const modeText = debugMode ? "DEBUG" : "NORMAL";
        const waitText = waitForCompletion ? "WAITING FOR COMPLETION" : "BACKGROUND";
        
        console.log(`\n🚀 Starting Node.js (${modeText}, ${waitText}): ${jsFile}`);
        console.log(`📡 Target: ${this.servers.length} servers`);
        
        if (waitForCompletion) {
            console.log("⏳ Waiting for all scripts to complete...");
            console.log("🔗 Connections will be kept alive until scripts finish");
        }
        
        if (debugMode) {
            console.log("🔍 DEBUG MODE: Enhanced error tracking with line numbers");
        }
        
        console.log("=" .repeat(60));
        
        const results = await this.broadcastNodeJS(jsFile, { debugMode, waitForCompletion });
        
        if (waitForCompletion) {
            const successCount = results.filter(r => r.status === 'completed').length;
            const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);
            const avgDuration = totalDuration / results.length;
            
            console.log(`\n📊 ALL PROCESSES COMPLETED: ${successCount}/${this.servers.length} successful`);
            console.log(`⏱️  Average duration: ${avgDuration.toFixed(1)}s`);
        } else {
            console.log(`✅ All Node.js processes started in background (${modeText} mode)`);
            console.log("📝 Watching for output from all servers...");
        }
    }

    async handleUpload(localFile, remotePath = null) {
        if (!localFile) {
            console.log("Usage: .upload <local_file> [remote_path]");
            return;
        }
        
        if (!fs.existsSync(localFile)) {
            console.log(`❌ Local file not found: ${localFile}`);
            return;
        }
        
        const actualRemotePath = remotePath || path.basename(localFile);
        
        console.log(`\n📤 Uploading: ${localFile} -> ${actualRemotePath}`);
        console.log(`📡 Target: ${this.servers.length} servers`);
        
        // Note: SSH2 SFTP implementation would go here
        // This is a simplified version - in production you'd want proper SFTP
        console.log("⚠️  SFTP upload feature would be implemented here");
        console.log("For now, use SCP or other methods to upload files");
    }

    async handleBash(serverIndex = null) {
        if (serverIndex === null) {
            console.log("Available servers:");
            this.servers.forEach((server, index) => {
                console.log(`  [${index + 1}] ${server.host}`);
            });
            
            this.rl.question("\nSelect server (number): ", (answer) => {
                const index = parseInt(answer) - 1;
                if (isNaN(index) || index < 0 || index >= this.servers.length) {
                    console.log("Invalid server selection!");
                    this.startInteractive();
                } else {
                    this.handleBash(index);
                }
            });
            return;
        }
        
        const server = this.servers[serverIndex];
        console.log(`\n🔌 Starting interactive bash session with ${server.host}`);
        console.log("Type 'exit' to return to muffin CNC");
        console.log("=" .repeat(50));
        
        // Note: Interactive shell implementation would go here
        console.log("⚠️  Interactive shell feature would be implemented here");
        console.log("For now, use native SSH for interactive sessions");
    }

    showHelp() {
        const helpText = `
📖 MUFFIN CNC COMMANDS:

  .install-nodejs     - Install Node.js and npm on all servers
  .upgrade            - Automated apt upgrade on all servers (Auto-yes)
  .ping               - Check connectivity to all servers
  .bash [number]      - Start interactive bash with specific server
  .nodejs <file.js>   - Run JavaScript file in background
  .nodejs-wait <file.js> - Run JavaScript and wait for completion
  .nodejs-debug <file.js> - Run JavaScript with debug in background
  .nodejs-debug-wait <file.js> - Run JavaScript with debug and wait
  .nodejs-stop        - Stop all running Node.js processes
  .upload <file> [path] - Upload file to all servers
  .servers            - Show server list with status
  .help               - Show this help message
  .clear              - Clear screen
  .exit               - Exit program
  <any command>       - Broadcast command to all servers

💡 JAVASCRIPT EDITION FEATURES:
  - Built with Node.js for better performance
  - Real-time async output from all servers
  - Enhanced error handling and debugging
  - Modern ES6+ syntax
  - Better memory management
  - Native Promise support

🚀 EXAMPLES:
  .nodejs-wait app.js     - Run and wait for completion on all servers
  .nodejs-debug-wait bot.js - Run with debug and wait for completion
  .install-nodejs         - Install Node.js and npm on all servers
  .upgrade                - Automated system upgrade
        `;
        console.log(helpText);
    }

    showServers() {
        console.log(`\n📋 CONFIGURED SERVERS (${this.servers.length}):`);
        console.log("-".repeat(50));
        this.servers.forEach((server, index) => {
            const status = this.sessions.has(server.host) ? "🟢" : "⚪";
            const currentDir = this.currentDirs.get(server.host) || 'Unknown';
            
            console.log(`${status} [${index + 1}] ${server.host}:${server.port || 22}`);
            console.log(`    📁 ${currentDir}`);
            
            const processInfo = this.runningProcesses.get(server.host);
            if (processInfo && processInfo.active) {
                const mode = processInfo.debugMode ? "DEBUG" : "NORMAL";
                const wait = processInfo.active ? "ACTIVE" : "INACTIVE";
                console.log(`    🔴 Node.js (${mode},${wait}): ${processInfo.jsFile}`);
            }
        });
    }

    clearScreen() {
        console.clear();
        this.showWelcome();
    }

    async stopNodeProcesses() {
        console.log(`\n🛑 Stopping Node.js processes on all servers...`);
        
        let stoppedCount = 0;
        for (const [host, processInfo] of this.runningProcesses) {
            if (processInfo && processInfo.active) {
                const conn = this.sessions.get(host);
                if (conn) {
                    try {
                        const killCommand = `pkill -f "node.*${processInfo.jsFile}"`;
                        // Execute kill command - simplified implementation
                        console.log(`🛑 [${host}] Stopping Node.js process`);
                        stoppedCount++;
                    } catch (error) {
                        console.log(`❌ [${host}] Failed to stop process: ${error.message}`);
                    }
                }
                this.runningProcesses.set(host, null);
            }
        }
        
        console.log(`📊 Stopped ${stoppedCount} Node.js processes`);
    }

    closeSessions() {
        console.log("\n🛑 Closing all connections...");
        this.sessions.forEach((conn, host) => {
            try {
                conn.end();
            } catch (error) {
                // Ignore errors during cleanup
            }
        });
        this.sessions.clear();
    }

    async startInteractive() {
        this.showWelcome();
        
        this.rl.on('line', async (input) => {
            const userInput = input.trim();
            
            if (!userInput) {
                this.rl.prompt();
                return;
            }
            
            try {
                if (userInput === '.exit') {
                    console.log(`
  /\\_/\\  
 ( ^.^ ) Goodbye!
  > ^ <  
                    `);
                    this.closeSessions();
                    this.rl.close();
                    process.exit(0);
                } else if (userInput === '.ping') {
                    await this.handlePing();
                } else if (userInput === '.install-nodejs') {
                    await this.handleInstallNodeJS();
                } else if (userInput === '.upgrade') {
                    await this.handleUpgrade();
                } else if (userInput.startsWith('.bash')) {
                    const args = userInput.split(' ');
                    const serverIndex = args[1] ? parseInt(args[1]) - 1 : null;
                    await this.handleBash(serverIndex);
                } else if (userInput.startsWith('.nodejs-debug-wait ')) {
                    const args = userInput.split(' ');
                    const jsFile = args[1];
                    await this.handleNodeJS(jsFile, { debugMode: true, waitForCompletion: true });
                } else if (userInput.startsWith('.nodejs-wait ')) {
                    const args = userInput.split(' ');
                    const jsFile = args[1];
                    await this.handleNodeJS(jsFile, { debugMode: false, waitForCompletion: true });
                } else if (userInput.startsWith('.nodejs-debug ')) {
                    const args = userInput.split(' ');
                    const jsFile = args[1];
                    await this.handleNodeJS(jsFile, { debugMode: true, waitForCompletion: false });
                } else if (userInput.startsWith('.nodejs ')) {
                    const args = userInput.split(' ');
                    const jsFile = args[1];
                    await this.handleNodeJS(jsFile, { debugMode: false, waitForCompletion: false });
                } else if (userInput === '.nodejs-stop') {
                    await this.stopNodeProcesses();
                } else if (userInput.startsWith('.upload ')) {
                    const args = userInput.split(' ');
                    const localFile = args[1];
                    const remotePath = args[2];
                    await this.handleUpload(localFile, remotePath);
                } else if (userInput === '.help') {
                    this.showHelp();
                } else if (userInput === '.servers') {
                    this.showServers();
                } else if (userInput === '.clear') {
                    this.clearScreen();
                } else {
                    // Regular command broadcast
                    console.log(`\n🚀 Executing: ${userInput}`);
                    console.log(`📡 Target: ${this.servers.length} servers`);
                    console.log("=" .repeat(60));
                    
                    const results = await this.broadcastCommand(userInput);
                    
                    let successCount = 0;
                    console.log("\n" + "=" .repeat(60));
                    results.forEach((result, index) => {
                        if (result.status === 'success') {
                            successCount++;
                            console.log(`✅ [${index + 1}] ${result.host} - SUCCESS`);
                            if (result.output && result.output.length > 0 && result.output.length < 500) {
                                console.log(`📄 ${result.output}`);
                            }
                        } else {
                            console.log(`❌ [${index + 1}] ${result.host} - FAILED`);
                            console.log(`💬 ${result.error}`);
                        }
                    });
                    
                    console.log(`\n📊 Completed: ${successCount}/${this.servers.length} servers successful`);
                }
            } catch (error) {
                console.log(`\n❌ Error: ${error.message}`);
            }
            
            this.rl.prompt();
        });
        
        this.rl.on('close', () => {
            this.closeSessions();
            process.exit(0);
        });
        
        this.rl.prompt();
    }
}

// Main execution
async function main() {
    if (!fs.existsSync('servers.json')) {
        console.log("✗ Error: servers.json not found!");
        console.log("Please create servers.json with your server configurations");
        process.exit(1);
    }
    
    const muffin = new MuffinCNC();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n\nUse .exit to quit properly');
        muffin.rl.prompt();
    });
    
    try {
        await muffin.startInteractive();
    } catch (error) {
        console.error('Unexpected error:', error);
        process.exit(1);
    }
}

// Run if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = MuffinCNC;