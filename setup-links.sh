#!/bin/bash

echo "🔗 Setup liens symboliques Thunder"
echo "================================="

PROJECT_DIR="$HOME/zone-01/payment-channel"
THUNDERD_PATH="$PROJECT_DIR/build/executables/thunderd-Linux-x64"
CLI_PATH="$PROJECT_DIR/build/executables/thunder-cli-Linux-x64"

# Vérifier que les executables existent
if [ ! -f "$THUNDERD_PATH" ]; then
    echo "❌ $THUNDERD_PATH non trouvé"
    exit 1
fi

if [ ! -f "$CLI_PATH" ]; then
    echo "❌ $CLI_PATH non trouvé"
    exit 1
fi

# Supprimer anciens liens
sudo rm -f /usr/local/bin/thunderd /usr/local/bin/thunder-cli

# Créer nouveaux liens
sudo ln -sf "$THUNDERD_PATH" /usr/local/bin/thunderd
sudo ln -sf "$CLI_PATH" /usr/local/bin/thunder-cli

# Permissions
sudo chmod +x /usr/local/bin/thunderd /usr/local/bin/thunder-cli

echo "✅ Liens créés :"
echo "   thunderd -> $THUNDERD_PATH"
echo "   thunder-cli -> $CLI_PATH"

# Test
echo "🧪 Test :"
thunderd --version
thunder-cli --version

echo "🎉 Prêt ! Tu peux maintenant utiliser :"
echo "   thunderd"
echo "   thunder-cli infos"
echo "   thunder-cli proposals"