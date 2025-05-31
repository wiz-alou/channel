#!/bin/bash

# Thunder Payment Channel - Upload Release Files via Gitea API

set -e

echo "⚡ Uploading Thunder v1.0.0 files to Gitea Release..."

# Configuration
GITEA_URL="https://learn.zone01dakar.sn"
REPO_OWNER="alassall"
REPO_NAME="payment-channel"
TAG="v1.0.0"
BUILD_DIR="build/executables"
GITEA_TOKEN="d4fc08a5b76482cef903cbb8a81bb4e0c579aed3"

# Fichiers à uploader
FILES=(
    "payment-channel-Linux-x64.tar.gz"
    "payment-channel-macOS-Intel.tar.gz"
    "payment-channel-macOS-Apple-Silicon.tar.gz"
    "payment-channel-Windows-x64.zip"
    "install.sh"
    "checksums.txt"
)

echo "📦 Uploading files to release $TAG..."

for file in "${FILES[@]}"; do
    filepath="$BUILD_DIR/$file"
    
    if [ -f "$filepath" ]; then
        echo "  📤 Uploading $file..."
        
        curl -X POST \
            -H "Authorization: token $GITEA_TOKEN" \
            -H "Content-Type: multipart/form-data" \
            -F "attachment=@$filepath" \
            "$GITEA_URL/api/v1/repos/$REPO_OWNER/$REPO_NAME/releases/tags/$TAG/assets"
        
        echo "    ✅ $file uploaded"
    else
        echo "    ❌ $file not found"
    fi
done

echo "🎉 Upload complete!"