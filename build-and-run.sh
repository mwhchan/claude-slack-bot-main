#!/bin/bash
#
# Claude Slack Bot - Build & Run Script
# Builds the TypeScript bot and launches the macOS monitor app
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$SCRIPT_DIR/Client"
PROJECT="$CLIENT_DIR/ClaudeBotMonitor.xcodeproj"
SCHEME="ClaudeBotMonitor"
CONFIG="Debug"
BUILD_DIR="$CLIENT_DIR/build"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "========================================"
echo "   Claude Slack Bot - Build & Run"
echo "========================================"
echo ""

# Check xcodebuild
if ! command -v xcodebuild &> /dev/null; then
    echo -e "${RED}[ERROR]${NC} xcodebuild not found. Install Xcode Command Line Tools:"
    echo "  xcode-select --install"
    exit 1
fi

# Build TypeScript bot
echo -e "${BLUE}[BUILD]${NC} Building TypeScript bot..."
(cd "$SCRIPT_DIR" && npm run build)
echo -e "${GREEN}[OK]${NC} TypeScript build complete"

# Build macOS app
echo -e "${BLUE}[BUILD]${NC} Building $SCHEME ($CONFIG)..."
xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$CONFIG" \
    -derivedDataPath "$BUILD_DIR" \
    build \
    -quiet

APP_PATH="$BUILD_DIR/Build/Products/$CONFIG/ClaudeBotMonitor.app"

if [ ! -d "$APP_PATH" ]; then
    echo -e "${RED}[ERROR]${NC} Build succeeded but app not found at $APP_PATH"
    exit 1
fi

echo -e "${GREEN}[OK]${NC} Build complete"

# Launch
echo -e "${BLUE}[RUN]${NC} Launching ClaudeBotMonitor..."
open "$APP_PATH"
