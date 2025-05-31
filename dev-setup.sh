#!/bin/bash

echo "🚀 Configuration environnement de développement Thunder"
echo "======================================================"

PROJECT_DIR="$HOME/zone-01/payment-channel"

# Vérifier que nous sommes dans le bon répertoire
if [ ! -f "$PROJECT_DIR/package.json" ]; then
    echo "❌ Projet non trouvé dans $PROJECT_DIR"
    echo "💡 Assure-toi d'être dans le bon répertoire"
    exit 1
fi

# Vérifier que Node.js est installé
if ! command -v node &> /dev/null; then
    echo "❌ Node.js n'est pas installé"
    echo "💡 Installe Node.js 16+ depuis https://nodejs.org"
    exit 1
fi

# Vérifier les dépendances
echo "📦 Vérification des dépendances..."
cd "$PROJECT_DIR"
if [ ! -d "node_modules" ]; then
    echo "📥 Installation des dépendances..."
    npm install
fi

# Supprimer TOUS les anciens liens (exécutables ET scripts)
echo "🧹 Suppression complète des anciens liens..."
sudo rm -f /usr/local/bin/thunderd /usr/local/bin/thunder-cli

# Vérifier qu'ils sont bien supprimés
if [ -f "/usr/local/bin/thunderd" ] || [ -f "/usr/local/bin/thunder-cli" ]; then
    echo "⚠️  Suppression manuelle nécessaire..."
    sudo unlink /usr/local/bin/thunderd 2>/dev/null || true
    sudo unlink /usr/local/bin/thunder-cli 2>/dev/null || true
fi

# Créer scripts wrapper pour développement DIRECT
echo "📝 Création des liens vers le code source JavaScript..."

# Script wrapper pour thunderd - DIRECT vers le code source
sudo tee /usr/local/bin/thunderd > /dev/null << 'EOF'
#!/bin/bash
# Thunder Development Script - Direct vers code source
THUNDER_PROJECT="$HOME/zone-01/payment-channel"
cd "$THUNDER_PROJECT"
exec node src/thunderd.js "$@"
EOF

# Script wrapper pour thunder-cli - DIRECT vers le code source  
sudo tee /usr/local/bin/thunder-cli > /dev/null << 'EOF'
#!/bin/bash
# Thunder CLI Development Script - Direct vers code source
THUNDER_PROJECT="$HOME/zone-01/payment-channel"
cd "$THUNDER_PROJECT"
exec node src/thunder-cli.js "$@"
EOF

# Rendre exécutables
sudo chmod +x /usr/local/bin/thunderd /usr/local/bin/thunder-cli

echo "✅ Environnement de développement configuré !"
echo ""
echo "🔥 Mode développement DIRECT activé :"
echo "   • thunderd -> node src/thunderd.js (CODE SOURCE)"
echo "   • thunder-cli -> node src/thunder-cli.js (CODE SOURCE)"
echo "   • ✨ TOUTES tes modifications sont prises en compte IMMÉDIATEMENT"
echo ""
echo "🚫 Anciens liens vers exécutables SUPPRIMÉS"
echo "🧪 Test des commandes :"
echo "   thunderd --help"
echo "   thunder-cli --help"
echo ""

# Test
echo "🔍 Vérification..."
if thunderd --help > /dev/null 2>&1; then
    echo "✅ thunderd fonctionne"
else
    echo "❌ Problème avec thunderd"
fi

if thunder-cli --help > /dev/null 2>&1; then
    echo "✅ thunder-cli fonctionne"
else
    echo "❌ Problème avec thunder-cli"
fi

echo ""
echo "🎉 Prêt pour le développement !"
echo "💡 Tes modifications seront maintenant prises en compte immédiatement"
echo ""
echo "🚀 Commandes de développement :"
echo "   thunderd                    # Démarre le node (port 2001)"
echo "   thunderd --port 2002       # Démarre sur port 2002"
echo "   thunder-cli infos          # Informations du node"
echo "   thunder-cli balance        # Solde du wallet"
echo ""
echo "🔄 Pour revenir aux exécutables compilés :"
echo "   ./build.sh && ./setup-executables.sh"