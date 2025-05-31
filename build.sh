#!/bin/bash

# Thunder Payment Channel - Multi-Platform Build Script
# Creates executables for Linux, macOS, and Windows

set -e

echo "⚡ Thunder Payment Channel - Multi-Platform Builder"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if pkg is installed
if ! command -v pkg &> /dev/null; then
    echo -e "${RED}❌ PKG not found. Installing...${NC}"
    npm install -g pkg
fi

# Create build directory
BUILD_DIR="build/executables"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

echo -e "${BLUE}📦 Building executables...${NC}"

# Define targets
declare -A TARGETS=(
    ["Linux-x64"]="node18-linux-x64"
    ["macOS-Intel"]="node18-macos-x64"
    ["macOS-Apple-Silicon"]="node18-macos-arm64"
    ["Windows-x64"]="node18-win-x64"
)

# Build thunderd for each platform
echo -e "${YELLOW}🔨 Building thunderd...${NC}"
for platform in "${!TARGETS[@]}"; do
    target="${TARGETS[$platform]}"
    output="$BUILD_DIR/thunderd-$platform"
    
    if [[ "$platform" == "Windows-x64" ]]; then
        output="$output.exe"
    fi
    
    echo "  Building for $platform..."
    pkg src/thunderd.js --target "$target" --output "$output" --compress GZip
    
    if [[ -f "$output" ]]; then
        size=$(du -h "$output" | cut -f1)
        echo -e "    ✅ ${GREEN}thunderd-$platform${NC} ($size)"
    else
        echo -e "    ❌ ${RED}Failed to build thunderd-$platform${NC}"
        exit 1
    fi
done

# Build thunder-cli for each platform
echo -e "${YELLOW}🔨 Building thunder-cli...${NC}"
for platform in "${!TARGETS[@]}"; do
    target="${TARGETS[$platform]}"
    output="$BUILD_DIR/thunder-cli-$platform"
    
    if [[ "$platform" == "Windows-x64" ]]; then
        output="$output.exe"
    fi
    
    echo "  Building for $platform..."
    pkg src/thunder-cli.js --target "$target" --output "$output" --compress GZip
    
    if [[ -f "$output" ]]; then
        size=$(du -h "$output" | cut -f1)
        echo -e "    ✅ ${GREEN}thunder-cli-$platform${NC} ($size)"
    else
        echo -e "    ❌ ${RED}Failed to build thunder-cli-$platform${NC}"
        exit 1
    fi
done

# Create archives for distribution
echo -e "${YELLOW}📦 Creating distribution archives...${NC}"

# Linux
echo "  Creating Linux archive..."
cd "$BUILD_DIR"
tar -czf "payment-channel-Linux-x64.tar.gz" thunderd-Linux-x64 thunder-cli-Linux-x64
echo -e "    ✅ ${GREEN}payment-channel-Linux-x64.tar.gz${NC}"

# macOS Intel
echo "  Creating macOS Intel archive..."
tar -czf "payment-channel-macOS-Intel.tar.gz" thunderd-macOS-Intel thunder-cli-macOS-Intel
echo -e "    ✅ ${GREEN}payment-channel-macOS-Intel.tar.gz${NC}"

# macOS Apple Silicon
echo "  Creating macOS Apple Silicon archive..."
tar -czf "payment-channel-macOS-Apple-Silicon.tar.gz" thunderd-macOS-Apple-Silicon thunder-cli-macOS-Apple-Silicon
echo -e "    ✅ ${GREEN}payment-channel-macOS-Apple-Silicon.tar.gz${NC}"

# Windows
echo "  Creating Windows archive..."
zip -q "payment-channel-Windows-x64.zip" thunderd-Windows-x64.exe thunder-cli-Windows-x64.exe
echo -e "    ✅ ${GREEN}payment-channel-Windows-x64.zip${NC}"

cd - > /dev/null

echo ""
echo -e "${GREEN}🎉 Build completed successfully!${NC}"
echo -e "${BLUE}📊 Built executables:${NC}"
ls -lh "$BUILD_DIR/" | grep -E "\.(exe|tar\.gz|zip)$" | awk '{printf "  %s (%s)\n", $9, $5}'

echo ""
echo -e "${YELLOW}💡 Next steps:${NC}"
echo "  1. Test executables: ./build/executables/thunderd-Linux-x64 --help"
echo "  2. Upload to Gitea releases"
echo "  3. Update README with download links"