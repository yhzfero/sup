#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Banner
echo -e "${GREEN}"
cat << "EOF"
╔═══════════════════════════════════════╗
║        HTTP/2 FLOOD SETUP             ║
║        Auto-Install Script            ║
╚═══════════════════════════════════════╝
EOF
echo -e "${NC}"

# Function to print status
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    print_warning "Running as root user"
fi

# Detect OS and package manager
detect_package_manager() {
    if command -v apt-get &> /dev/null; then
        echo "apt"
    elif command -v yum &> /dev/null; then
        echo "yum"
    elif command -v dnf &> /dev/null; then
        echo "dnf"
    elif command -v pacman &> /dev/null; then
        echo "pacman"
    elif command -v apk &> /dev/null; then
        echo "apk"
    else
        echo "unknown"
    fi
}

PM=$(detect_package_manager)
print_status "Detected package manager: $PM"

# Install system dependencies
install_system_deps() {
    print_status "Installing system dependencies..."
    
    case $PM in
        "apt")
            sudo apt-get update
            sudo apt-get install -y \
                curl \
                wget \
                git \
                build-essential \
                python3 \
                python3-pip \
                libnss3 \
                libatk-bridge2.0-0 \
                libdrm2 \
                libxkbcommon0 \
                libxcomposite1 \
                libxdamage1 \
                libxrandr2 \
                libgbm1 \
                libxss1 \
                libgtk-3-0 \
                libasound2
            ;;
        "yum")
            sudo yum update -y
            sudo yum install -y \
                curl \
                wget \
                git \
                gcc-c++ \
                python3 \
                python3-pip \
                libX11 \
                libXcomposite \
                libXcursor \
                libXdamage \
                libXext \
                libXi \
                libXtst \
                cups-libs \
                libXScrnSaver \
                libXrandr \
                alsa-lib \
                pango \
                atk \
                at-spi2-atk \
                gtk3
            ;;
        "dnf")
            sudo dnf update -y
            sudo dnf install -y \
                curl \
                wget \
                git \
                gcc-c++ \
                python3 \
                python3-pip \
                libX11 \
                libXcomposite \
                libXcursor \
                libXdamage \
                libXext \
                libXi \
                libXtst \
                cups-libs \
                libXScrnSaver \
                libXrandr \
                alsa-lib \
                pango \
                atk \
                at-spi2-atk \
                gtk3
            ;;
        "pacman")
            sudo pacman -Sy --noconfirm \
                curl \
                wget \
                git \
                base-devel \
                python \
                python-pip \
                nss \
                atk \
                at-spi2-atk \
                gtk3 \
                libdrm \
                libxkbcommon \
                libxcomposite \
                libxdamage \
                libxrandr \
                libgbm \
                libxss \
                alsa-lib
            ;;
        "apk")
            sudo apk update
            sudo apk add \
                curl \
                wget \
                git \
                build-base \
                python3 \
                python3-dev \
                nss \
                at-spi2-core \
                gtk+3.0 \
                libdrm \
                libxkbcommon \
                libxcomposite \
                libxdamage \
                libxrandr \
                libgbm \
                libxss \
                alsa-lib
            ;;
        *)
            print_error "Unsupported package manager: $PM"
            print_warning "Please install Node.js and dependencies manually"
            exit 1
            ;;
    esac
}

# Install Node.js
install_nodejs() {
    if command -v node &> /dev/null && node --version | grep -q "v18\|v20\|v21"; then
        print_status "Node.js is already installed: $(node --version)"
        return 0
    fi

    print_status "Installing Node.js..."
    
    # Try using package manager first
    case $PM in
        "apt")
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        "yum"|"dnf")
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            sudo $PM install -y nodejs
            ;;
        "pacman")
            sudo pacman -S --noconfirm nodejs npm
            ;;
        "apk")
            sudo apk add nodejs npm
            ;;
        *)
            # Fallback to NodeSource script
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
    esac

    if ! command -v node &> /dev/null; then
        print_error "Failed to install Node.js"
        exit 1
    fi

    print_success "Node.js installed: $(node --version)"
    print_success "npm installed: $(npm --version)"
}

# Install npm dependencies
install_npm_deps() {
    print_status "Installing npm dependencies..."
    
    # Create package.json if it doesn't exist
    if [ ! -f "package.json" ]; then
        cat > package.json << EOF
{
  "name": "http2-flood-tool",
  "version": "1.0.0",
  "description": "HTTP/2 Flood Attack Tool",
  "main": "berongseng.js",
  "scripts": {
    "start": "node berongseng.js",
    "flood": "node flood.js"
  },
  "dependencies": {
    "puppeteer-extra": "^3.3.6",
    "puppeteer-extra-plugin-stealth": "^2.11.2",
    "async": "^3.2.5",
    "chalk": "^4.1.2",
    "user-agents": "^1.1.1",
    "header-generator": "^1.1.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
EOF
        print_status "Created package.json"
    fi

    # Install dependencies
    npm install
    
    # Install additional puppeteer dependencies
    print_status "Installing Puppeteer browser..."
    npx puppeteer browsers install chrome
    
    print_success "npm dependencies installed successfully"
}

# Create necessary files
create_required_files() {
    print_status "Creating required files..."
    
    # Create proxies.txt if it doesn't exist
    if [ ! -f "proxies.txt" ]; then
        cat > proxies.txt << EOF
# Add your proxies here (one per line)
# Format: ip:port or user:pass@ip:port
# Example:
# 192.168.1.1:8080
# user:password@45.76.102.33:3128
EOF
        print_status "Created proxies.txt - please add your proxies"
    fi

    # Create ua.txt if it doesn't exist
    if [ ! -f "ua.txt" ]; then
        cat > ua.txt << EOF
# User agents will be generated automatically
# You can add custom user agents here if needed
EOF
        print_status "Created ua.txt"
    fi

    # Create flood.js if it doesn't exist (from previous implementation)
    if [ ! -f "flood.js" ]; then
        print_error "flood.js not found! Please ensure both scripts are in the same directory"
        print_status "You can create flood.js using the code provided in the documentation"
    fi

    # Create test script
    cat > test-setup.js << EOF
const puppeteer = require('puppeteer-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const chalk = require('chalk');

async function testSetup() {
    try {
        console.log(chalk.blue('[TEST] Testing setup...'));
        
        puppeteer.use(stealth());
        const browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.goto('https://httpbin.org/user-agent', { waitUntil: 'domcontentloaded' });
        
        console.log(chalk.green('[TEST] ✓ Puppeteer setup successful'));
        await browser.close();
        
        // Test other dependencies
        const async = require('async');
        const UserAgent = require('user-agents');
        const { HeaderGenerator } = require('header-generator');
        
        console.log(chalk.green('[TEST] ✓ All dependencies loaded successfully'));
        console.log(chalk.green('[SETUP] System is ready!'));
        
    } catch (error) {
        console.log(chalk.red('[TEST] ✗ Setup test failed:'), error.message);
        process.exit(1);
    }
}

testSetup();
EOF
}

# Setup completion
setup_complete() {
    echo -e "${GREEN}"
    cat << "EOF"
╔═══════════════════════════════════════╗
║           SETUP COMPLETE!             ║
╚═══════════════════════════════════════╝
EOF
    echo -e "${NC}"
    
    print_success "All dependencies installed successfully"
    echo ""
    print_status "Next steps:"
    echo "1. Add proxies to ${GREEN}proxies.txt${NC}"
    echo "2. Add target URLs to use with the tool"
    echo "3. Run test: ${GREEN}node test-setup.js${NC}"
    echo ""
    print_status "Usage examples:"
    echo "node berongsong.js https://example.com 60 5 10 100 proxies.txt"
    echo "node flood.js https://example.com 60 10 proxy:port 50 'cookies' 'user-agent'"
    echo ""
    
    # Run basic test
    print_status "Running quick test..."
    if node test-setup.js; then
        print_success "All tests passed! You're ready to go."
    else
        print_warning "Some tests failed, but basic setup is complete"
    fi
}

# Cleanup function
cleanup() {
    print_status "Cleaning up temporary files..."
    rm -f test-setup.js
}

# Main execution
main() {
    print_status "Starting automated setup..."
    
    # Install system dependencies
    install_system_deps
    
    # Install Node.js
    install_nodejs
    
    # Install npm dependencies
    install_npm_deps
    
    # Create required files
    create_required_files
    
    # Complete setup
    setup_complete
    
    # Cleanup
    cleanup
}

# Handle script interruption
trap cleanup EXIT INT TERM

# Run main function
main