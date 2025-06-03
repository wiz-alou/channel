const fs = require('fs');
const path = require('path');

class Utils {
    /**
     * Charge les informations de déploiement pour un réseau donné
     * @param {string} network - Nom du réseau (localhost, sepolia, mainnet)
     * @returns {Object} Informations de déploiement
     */
    static loadDeploymentInfo(network = 'localhost') {
        try {
            // Liste des réseaux supportés avec fallbacks
            const supportedNetworks = ['localhost', 'sepolia', 'mainnet'];
            
            // Vérifie si le réseau est supporté
            if (!supportedNetworks.includes(network)) {
                console.log(`⚠️  Unknown network: ${network}, falling back to localhost`);
                network = 'localhost';
            }
            
            const deploymentPath = path.join(__dirname, '..', '..', 'deployments', `${network}.json`);
            
            console.log(`📁 Loading deployment info for ${network}:`);
            console.log(`   Path: ${deploymentPath}`);
            
            if (!fs.existsSync(deploymentPath)) {
                // Messages d'aide spécifiques selon le réseau
                if (network === 'sepolia') {
                    throw new Error(`Sepolia deployment not found. Deploy first with: npx hardhat run scripts/deploy-sepolia.js --network sepolia`);
                } else if (network === 'localhost') {
                    throw new Error(`Local deployment not found. Deploy first with: npm run deploy`);
                } else {
                    throw new Error(`Deployment not found for network ${network}`);
                }
            }
            
            const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
            
            // Validation des données de déploiement
            const requiredFields = ['thdToken', 'network'];
            const missingFields = requiredFields.filter(field => !deploymentData[field]);
            
            if (missingFields.length > 0) {
                throw new Error(`Invalid deployment file. Missing fields: ${missingFields.join(', ')}`);
            }
            
            console.log(`✅ Deployment loaded successfully:`);
            console.log(`   Network: ${deploymentData.network}`);
            console.log(`   THD Token: ${this.formatAddress(deploymentData.thdToken)}`);
            
            if (deploymentData.deployedAt) {
                console.log(`   Deployed: ${new Date(deploymentData.deployedAt).toLocaleString()}`);
            }
            
            // Affiche l'explorateur pour les réseaux publics
            if (network === 'sepolia' && deploymentData.explorer) {
                console.log(`   🔍 Explorer: ${deploymentData.explorer.token}`);
            }
            
            return deploymentData;
            
        } catch (error) {
            console.error(`❌ Failed to load deployment info for network ${network}:`);
            console.error(`   Error: ${error.message}`);
            
            // Instructions d'aide
            if (network === 'sepolia') {
                console.error('\n💡 To deploy on Sepolia:');
                console.error('   1. Configure .env with SEPOLIA_RPC_URL and PRIVATE_KEY');
                console.error('   2. Get test ETH: https://sepoliafaucet.com/');
                console.error('   3. Run: npx hardhat run scripts/deploy-sepolia.js --network sepolia');
            } else if (network === 'localhost') {
                console.error('\n💡 To deploy locally:');
                console.error('   1. Start Hardhat node: npm run node');
                console.error('   2. Deploy contracts: npm run deploy');
            }
            
            throw error;
        }
    }
    
    /**
     * Sauvegarde les informations de déploiement
     * @param {string} network - Nom du réseau
     * @param {Object} deploymentData - Données de déploiement
     */
    static saveDeploymentInfo(network, deploymentData) {
        try {
            const deployDir = path.join(__dirname, '..', '..', 'deployments');
            
            // Crée le dossier s'il n'existe pas
            if (!fs.existsSync(deployDir)) {
                fs.mkdirSync(deployDir, { recursive: true });
                console.log(`📁 Created deployments directory`);
            }
            
            const deploymentPath = path.join(deployDir, `${network}.json`);
            
            // Ajoute des métadonnées
            const enrichedData = {
                ...deploymentData,
                network: network,
                savedAt: new Date().toISOString(),
                version: '1.0.0'
            };
            
            fs.writeFileSync(deploymentPath, JSON.stringify(enrichedData, null, 2));
            
            console.log(`✅ Deployment info saved:`);
            console.log(`   File: ${deploymentPath}`);
            console.log(`   Network: ${network}`);
            
            return deploymentPath;
            
        } catch (error) {
            console.error(`❌ Failed to save deployment info:`, error.message);
            throw error;
        }
    }
    
    /**
     * Formate une adresse Ethereum pour l'affichage
     * @param {string} address - Adresse complète
     * @returns {string} Adresse formatée
     */
    static formatAddress(address) {
        if (!address || typeof address !== 'string') {
            return 'N/A';
        }
        
        // Assure que l'adresse commence par 0x
        if (!address.startsWith('0x')) {
            address = '0x' + address;
        }
        
        // Vérifie la longueur (42 caractères pour une adresse ETH)
        if (address.length !== 42) {
            return address; // Retourne tel quel si format invalide
        }
        
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }
    
    /**
     * Formate un montant en wei vers THD avec support de différents réseaux
     * @param {BigInt} balance - Balance en wei
     * @param {number} decimals - Nombre de décimales (18 par défaut)
     * @returns {string} Balance formatée
     */
    static formatBalance(balance, decimals = 18) {
        try {
            if (balance === null || balance === undefined) {
                return '0';
            }
            
            // Conversion en BigInt si nécessaire
            if (typeof balance === 'string') {
                balance = BigInt(balance);
            } else if (typeof balance === 'number') {
                balance = BigInt(balance);
            }
            
            const divisor = BigInt(10 ** decimals);
            const wholePart = balance / divisor;
            const fractionalPart = balance % divisor;
            
            if (fractionalPart === BigInt(0)) {
                return wholePart.toString();
            } else {
                const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
                
                // Supprime les zéros de fin et limite à 4 décimales
                const trimmed = fractionalStr.replace(/0+$/, '');
                const decimalsToShow = Math.min(trimmed.length, 4);
                const decimalPart = trimmed.slice(0, decimalsToShow);
                
                return `${wholePart}.${decimalPart}`;
            }
        } catch (error) {
            console.error('Error formatting balance:', error.message);
            return '0';
        }
    }
    
    /**
     * Parse un montant THD vers wei
     * @param {string} amount - Montant en THD (ex: "10.5")
     * @param {number} decimals - Nombre de décimales
     * @returns {BigInt} Montant en wei
     */
    static parseAmount(amount, decimals = 18) {
        try {
            if (!amount || amount === '0') {
                return BigInt(0);
            }
            
            const amountStr = amount.toString();
            const [wholePart, fractionalPart = ''] = amountStr.split('.');
            
            // Assure que la partie fractionnaire n'a pas plus de décimales que supporté
            const truncatedFractional = fractionalPart.slice(0, decimals);
            const paddedFractional = truncatedFractional.padEnd(decimals, '0');
            
            const wholeWei = BigInt(wholePart || '0') * BigInt(10 ** decimals);
            const fractionalWei = BigInt(paddedFractional);
            
            return wholeWei + fractionalWei;
        } catch (error) {
            console.error('Error parsing amount:', error.message);
            throw new Error(`Invalid amount format: ${amount}`);
        }
    }
    
    /**
     * Valide une adresse Ethereum
     * @param {string} address - Adresse à valider
     * @returns {boolean} True si valide
     */
    static isValidAddress(address) {
        if (!address || typeof address !== 'string') {
            return false;
        }
        
        // Vérifie le format 0x suivi de 40 caractères hexadécimaux
        const addressRegex = /^0x[a-fA-F0-9]{40}$/;
        return addressRegex.test(address);
    }
    
    /**
     * Valide une clé privée
     * @param {string} privateKey - Clé privée à valider
     * @returns {boolean} True si valide
     */
    static isValidPrivateKey(privateKey) {
        if (!privateKey || typeof privateKey !== 'string') {
            return false;
        }
        
        // Vérifie le format 0x suivi de 64 caractères hexadécimaux
        const keyRegex = /^0x[a-fA-F0-9]{64}$/;
        return keyRegex.test(privateKey);
    }
    
    /**
     * Pause l'exécution pour un temps donné
     * @param {number} ms - Millisecondes
     * @returns {Promise} Promise qui se résout après le délai
     */
    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Génère un ID unique
     * @returns {string} ID unique
     */
    static generateId() {
        return Math.random().toString(36).substr(2, 9);
    }
    
    /**
     * Obtient les informations du réseau selon le Chain ID
     * @param {number} chainId - ID de la chaîne
     * @returns {Object} Informations du réseau
     */
    static getNetworkInfo(chainId) {
        const networks = {
            1: { 
                name: 'mainnet', 
                explorer: 'https://etherscan.io',
                nativeCurrency: 'ETH',
                rpc: 'https://cloudflare-eth.com'
            },
            11155111: { 
                name: 'sepolia', 
                explorer: 'https://sepolia.etherscan.io',
                nativeCurrency: 'ETH',
                rpc: 'https://rpc.sepolia.org',
                faucets: [
                    'https://sepoliafaucet.com/',
                    'https://faucets.chain.link/sepolia'
                ]
            },
            31337: { 
                name: 'localhost', 
                explorer: null,
                nativeCurrency: 'ETH',
                rpc: 'http://127.0.0.1:8545'
            },
            137: { 
                name: 'polygon', 
                explorer: 'https://polygonscan.com',
                nativeCurrency: 'MATIC',
                rpc: 'https://polygon-rpc.com'
            }
        };
        
        return networks[chainId] || { 
            name: 'unknown', 
            explorer: null,
            nativeCurrency: 'ETH',
            rpc: null
        };
    }
    
    /**
     * Formate un timestamp en date lisible
     * @param {string|number} timestamp - Timestamp à formatter
     * @returns {string} Date formatée
     */
    static formatTimestamp(timestamp) {
        try {
            const date = new Date(timestamp);
            return date.toLocaleString();
        } catch (error) {
            return 'Invalid date';
        }
    }
    
    /**
     * Calcule la différence de temps en format lisible
     * @param {string} timestamp - Timestamp de départ
     * @returns {string} Temps écoulé
     */
    static timeAgo(timestamp) {
        try {
            const now = Date.now();
            const time = new Date(timestamp).getTime();
            const diff = now - time;
            
            const seconds = Math.floor(diff / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);
            
            if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
            if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
            if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
            return `${seconds} second${seconds > 1 ? 's' : ''} ago`;
        } catch (error) {
            return 'Unknown';
        }
    }
    
    /**
     * Valide une URL RPC
     * @param {string} url - URL à valider
     * @returns {boolean} True si valide
     */
    static isValidRpcUrl(url) {
        if (!url || typeof url !== 'string') {
            return false;
        }
        
        try {
            const urlObj = new URL(url);
            return ['http:', 'https:', 'ws:', 'wss:'].includes(urlObj.protocol);
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Obtient les wallets de test pour un réseau
     * @param {string} network - Nom du réseau
     * @returns {Array} Liste des wallets de test
     */
    static getTestWallets(network = 'localhost') {
        const wallets = {
            localhost: [
                {
                    name: 'Account 0 (Deployer)',
                    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
                    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
                },
                {
                    name: 'Account 1 (Alice)',
                    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
                    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
                },
                {
                    name: 'Account 2 (Bob)',
                    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
                    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
                }
            ],
            sepolia: [] // Sera chargé depuis le fichier de déploiement
        };
        
        // Pour Sepolia, essaie de charger depuis le fichier de wallets de test
        if (network === 'sepolia') {
            try {
                const walletsPath = path.join(__dirname, '..', '..', 'deployments', 'sepolia-test-wallets.json');
                if (fs.existsSync(walletsPath)) {
                    const testWalletsData = JSON.parse(fs.readFileSync(walletsPath, 'utf8'));
                    return testWalletsData.wallets || [];
                }
            } catch (error) {
                console.log(`⚠️  Could not load Sepolia test wallets: ${error.message}`);
            }
        }
        
        return wallets[network] || [];
    }
    
    /**
     * Crée un résumé des informations réseau pour l'affichage
     * @param {Object} networkInfo - Informations du réseau
     * @returns {string} Résumé formaté
     */
    static formatNetworkSummary(networkInfo) {
        const { network, chainId, connected, rpc, account, thdToken, explorer } = networkInfo;
        
        let summary = `📊 Network: ${network.toUpperCase()} (Chain ID: ${chainId})\n`;
        summary += `🔗 Connected: ${connected ? '✅' : '❌'}\n`;
        summary += `🌐 RPC: ${rpc}\n`;
        
        if (account) {
            summary += `👤 Account: ${this.formatAddress(account)}\n`;
        }
        
        if (thdToken) {
            summary += `🪙 THD Token: ${this.formatAddress(thdToken)}\n`;
        }
        
        if (explorer) {
            summary += `🔍 Explorer: ${explorer}\n`;
        }
        
        return summary;
    }
}

module.exports = Utils;