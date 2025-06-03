/**
 * FICHIER: src/thunderd/server.js
 * 
 * DESCRIPTION:
 * Serveur principal Thunder avec support complet multi-réseau (localhost, Sepolia, mainnet).
 * VERSION COMPLÈTE avec injection P2P, synchronisation des fermetures, support bidirectionnel
 * et configuration automatique selon le réseau détecté.
 * 
 * NOUVELLES FONCTIONNALITÉS SEPOLIA:
 * - Auto-détection du réseau selon l'RPC
 * - Configuration dynamique des wallets selon le réseau
 * - Support des endpoints Sepolia publics
 * - Gestion des faucets et explorers
 * - Diagnostic réseau avancé
 * - Messages d'aide contextuels
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const BlockchainManager = require('./blockchain');
const ChannelManager = require('./channel');
const P2PManager = require('./p2p');
const Utils = require('../shared/utils');

class ThunderdServer {
    constructor(port = 2001, rpcUrl = null) {
        this.port = port;
        this.rpcUrl = rpcUrl || this.getDefaultRpcUrl();
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server);
        
        // Détection automatique du réseau
        this.detectedNetwork = this.detectNetworkFromRpc(this.rpcUrl);

        // Managers
        this.blockchain = new BlockchainManager(this.rpcUrl, this.detectedNetwork);
        this.channelManager = null;
        this.p2pManager = null;
        this.connectedPeers = new Map();
        this.channels = new Map();
        this.wallet = null;

        // Statistiques du serveur
        this.startTime = Date.now();
        this.requestCount = 0;
        this.networkInfo = null;

        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketHandlers();

        console.log(`🏗️  ThunderdServer initialized`);
        console.log(`   Port: ${this.port}`);
        console.log(`   RPC: ${this.rpcUrl}`);
        console.log(`   Detected Network: ${this.detectedNetwork.toUpperCase()}`);
    }

    // === DÉTECTION AUTOMATIQUE DU RÉSEAU ===

    /**
     * Obtient l'URL RPC par défaut selon les variables d'environnement
     */
    getDefaultRpcUrl() {
        if (process.env.SEPOLIA_RPC_URL) {
            return process.env.SEPOLIA_RPC_URL;
        }
        if (process.env.MAINNET_RPC_URL) {
            return process.env.MAINNET_RPC_URL;
        }
        return 'http://127.0.0.1:8545'; // localhost par défaut
    }

    /**
     * Détecte le réseau à partir de l'URL RPC
     */
    detectNetworkFromRpc(rpcUrl) {
        if (!rpcUrl) return 'localhost';
        
        const url = rpcUrl.toLowerCase();
        
        if (url.includes('sepolia')) return 'sepolia';
        if (url.includes('mainnet') || url.includes('cloudflare') || url.includes('infura.io/v3') && !url.includes('sepolia')) return 'mainnet';
        if (url.includes('polygon')) return 'polygon';
        if (url.includes('arbitrum')) return 'arbitrum';
        if (url.includes('optimism')) return 'optimism';
        if (url.includes('127.0.0.1') || url.includes('localhost')) return 'localhost';
        
        return 'unknown';
    }

    // === MIDDLEWARE SETUP ===

    setupMiddleware() {
        // Parse JSON bodies
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // CORS headers
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Content-Type');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
            next();
        });

        // Request logging et compteur
        this.app.use((req, res, next) => {
            this.requestCount++;
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] ${req.method} ${req.path} (${this.detectedNetwork})`);
            next();
        });
    }

    // === API ROUTES ===

    setupRoutes() {
        // Health check endpoint avec informations réseau
        this.app.get('/health', async (req, res) => {
            try {
                const uptime = Math.floor((Date.now() - this.startTime) / 1000);
                const blockchainHealth = await this.blockchain.healthCheck();
                
                res.json({
                    status: 'OK',
                    timestamp: new Date().toISOString(),
                    port: this.port,
                    version: '1.0.0-sepolia',
                    network: this.detectedNetwork,
                    rpc: this.rpcUrl,
                    uptime: uptime,
                    requests: this.requestCount,
                    blockchain: blockchainHealth,
                    capabilities: [
                        'channels', 
                        'payments', 
                        'p2p', 
                        'channel-sync', 
                        'bidirectional-proposals',
                        'multi-network',
                        'sepolia-support'
                    ]
                });
            } catch (error) {
                res.status(500).json({
                    status: 'ERROR',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        });

        // === ENDPOINTS DE DIAGNOSTIC AVANCÉS ===

        this.app.get('/debug/system', (req, res) => {
            try {
                const networkInfo = this.blockchain.getNetworkInfo();
                
                res.json({
                    success: true,
                    timestamp: new Date().toISOString(),
                    server: {
                        port: this.port,
                        rpcUrl: this.rpcUrl,
                        detectedNetwork: this.detectedNetwork,
                        uptime: Math.floor((Date.now() - this.startTime) / 1000),
                        requestCount: this.requestCount,
                        version: '1.0.0-sepolia'
                    },
                    components: {
                        blockchain: !!this.blockchain,
                        channelManager: !!this.channelManager,
                        p2pManager: !!this.p2pManager,
                        wallet: !!this.wallet
                    },
                    network: networkInfo,
                    injections: {
                        p2pIntoChannelManager: this.channelManager ? !!this.channelManager.p2pManager : false
                    },
                    features: {
                        multiNetwork: true,
                        sepoliaSupport: true,
                        bidirectionalProposals: true,
                        proposalMapping: !!this.p2pManager?.proposalToPeerMap,
                        channelSync: !!(this.channelManager && this.channelManager.p2pManager)
                    },
                    environment: {
                        nodeEnv: process.env.NODE_ENV || 'development',
                        hasSepoliaRpc: !!process.env.SEPOLIA_RPC_URL,
                        hasMainnetRpc: !!process.env.MAINNET_RPC_URL,
                        hasPrivateKey: !!process.env.PRIVATE_KEY
                    },
                    memoryUsage: process.memoryUsage(),
                    cpuUsage: process.cpuUsage()
                });
            } catch (error) {
                console.error('Debug system error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        });

        this.app.get('/debug/network', async (req, res) => {
            try {
                const networkInfo = this.blockchain.getNetworkInfo();
                const networkDetails = Utils.getNetworkInfo(networkInfo.chainId);
                
                // Test de connectivité
                let connectivityTest = null;
                try {
                    const blockNumber = await this.blockchain.web3.eth.getBlockNumber();
                    const gasPrice = await this.blockchain.web3.eth.getGasPrice();
                    
                    connectivityTest = {
                        success: true,
                        blockNumber: Number(blockNumber),
                        gasPrice: this.blockchain.web3.utils.fromWei(gasPrice.toString(), 'gwei') + ' Gwei',
                        responseTime: 'Fast'
                    };
                } catch (error) {
                    connectivityTest = {
                        success: false,
                        error: error.message
                    };
                }

                res.json({
                    success: true,
                    timestamp: new Date().toISOString(),
                    rpcUrl: this.rpcUrl,
                    detectedNetwork: this.detectedNetwork,
                    networkInfo: networkInfo,
                    networkDetails: networkDetails,
                    connectivity: connectivityTest,
                    deploymentStatus: {
                        hasDeployment: !!this.blockchain.deploymentInfo,
                        thdToken: this.blockchain.deploymentInfo?.thdToken || null,
                        deployedAt: this.blockchain.deploymentInfo?.deployedAt || null
                    },
                    recommendations: this.getNetworkRecommendations()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        });

        this.app.get('/debug/channels', (req, res) => {
            try {
                const channels = this.channelManager ? this.channelManager.getChannels() : [];
                const detailedChannels = channels.map(channel => {
                    const fullChannel = this.channelManager.channels.get(channel.id);
                    return {
                        ...channel,
                        funding: this.channelManager.userFunding.get(channel.id),
                        pendingPayments: fullChannel?.pendingPayments?.length || 0,
                        lastUpdate: fullChannel?.lastUpdate || 'unknown',
                        networkType: this.detectedNetwork
                    };
                });

                const diagnosticInfo = this.channelManager ? this.channelManager.getDiagnosticInfo() : {};

                res.json({
                    success: true,
                    timestamp: new Date().toISOString(),
                    network: this.detectedNetwork,
                    channels: detailedChannels,
                    diagnostic: diagnosticInfo,
                    p2pConnected: !!this.p2pManager,
                    peersCount: this.p2pManager ? this.p2pManager.getPeers().length : 0,
                    walletLoaded: !!this.wallet,
                    contractsDeployed: !!this.blockchain.deploymentInfo,
                    multiNetworkSupport: true
                });
            } catch (error) {
                console.error('Debug channels error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        });

        this.app.get('/debug/p2p', (req, res) => {
            try {
                const p2pInfo = this.p2pManager ? this.p2pManager.getDiagnosticInfo() : {};

                res.json({
                    success: true,
                    timestamp: new Date().toISOString(),
                    network: this.detectedNetwork,
                    p2pManager: !!this.p2pManager,
                    diagnostic: p2pInfo,
                    bidirectionalMappings: p2pInfo.proposalMappings || {},
                    globalConnectivity: {
                        networkType: this.detectedNetwork,
                        publicNetwork: ['sepolia', 'mainnet', 'polygon'].includes(this.detectedNetwork),
                        canConnectGlobally: this.detectedNetwork !== 'localhost'
                    }
                });
            } catch (error) {
                console.error('Debug P2P error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        });

        // === INFORMATIONS DU NODE AVEC SUPPORT MULTI-RÉSEAU ===

        this.app.get('/infos', (req, res) => {
            try {
                console.log(`📊 Processing /infos request for ${this.detectedNetwork}...`);

                const channels = this.channelManager ? this.channelManager.getChannels() : [];
                const peers = this.p2pManager ? this.p2pManager.getPeers() : [];
                const proposals = this.channelManager ? this.channelManager.getProposals() : [];

                console.log(`   Raw data: ${channels.length} channels, ${peers.length} peers, ${proposals.length} proposals`);

                // Fonction de sérialisation robuste
                function serializeBigIntDeep(obj, path = '') {
                    if (obj === null || obj === undefined) {
                        return obj;
                    }

                    if (typeof obj === 'bigint') {
                        console.log(`   Serializing BigInt at ${path}: ${obj}`);
                        return obj.toString();
                    }

                    if (Array.isArray(obj)) {
                        return obj.map((item, index) =>
                            serializeBigIntDeep(item, `${path}[${index}]`)
                        );
                    }

                    if (typeof obj === 'object') {
                        const result = {};
                        for (const [key, value] of Object.entries(obj)) {
                            const newPath = path ? `${path}.${key}` : key;
                            result[key] = serializeBigIntDeep(value, newPath);
                        }
                        return result;
                    }

                    return obj;
                }

                // Sérialisation des données
                const serializedProposals = proposals.map((proposal, index) => {
                    console.log(`     Proposal ${index}: ${proposal.id} (amount: ${typeof proposal.amount})`);
                    return serializeBigIntDeep(proposal, `proposal[${index}]`);
                });

                const serializedChannels = channels.map((channel, index) => {
                    console.log(`     Channel ${index}: ${channel.id} (state: ${channel.state})`);
                    return serializeBigIntDeep(channel, `channel[${index}]`);
                });

                const serializedPeers = serializeBigIntDeep(peers, 'peers');
                const blockchainInfo = serializeBigIntDeep(
                    this.blockchain.getNetworkInfo(),
                    'blockchain'
                );

                // Construction de la réponse avec informations réseau
                const responseData = {
                    port: this.port,
                    network: this.detectedNetwork,
                    rpcUrl: this.rpcUrl,
                    connectedPeers: serializedPeers,
                    channels: serializedChannels,
                    pendingProposals: serializedProposals,
                    blockchain: blockchainInfo,
                    wallet: this.wallet ? Utils.formatAddress(this.wallet.address) : null,
                    version: '1.0.0-sepolia',
                    uptime: Math.floor((Date.now() - this.startTime) / 1000),
                    requestCount: this.requestCount,
                    features: {
                        p2pSyncEnabled: !!(this.channelManager && this.channelManager.p2pManager),
                        bidirectionalProposals: true,
                        proposalMappingActive: !!this.p2pManager?.proposalToPeerMap,
                        multiNetworkSupport: true,
                        sepoliaSupport: true,
                        globalConnectivity: this.detectedNetwork !== 'localhost'
                    },
                    networkDetails: this.getNetworkDetails(),
                    helpLinks: this.getHelpLinks()
                };

                // Vérification finale de sérialisation
                const finalSerialized = serializeBigIntDeep(responseData, 'response');

                try {
                    JSON.stringify(finalSerialized);
                    console.log(`✅ JSON serialization test passed for ${this.detectedNetwork}`);
                } catch (jsonError) {
                    console.error(`❌ JSON serialization test failed:`, jsonError.message);
                    throw new Error(`JSON serialization failed: ${jsonError.message}`);
                }

                console.log(`📊 /infos response ready for ${this.detectedNetwork} - sending to client`);
                res.json(finalSerialized);

            } catch (error) {
                console.error('❌ /infos endpoint error:', error.message);
                console.error('   Stack:', error.stack);

                res.status(500).json({
                    success: false,
                    error: 'Internal server error',
                    network: this.detectedNetwork,
                    timestamp: new Date().toISOString(),
                    details: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
                });
            }
        });

        // === GESTION DU WALLET AVEC SUPPORT MULTI-RÉSEAU ===

        this.app.post('/importwallet', async (req, res) => {
            try {
                const { seedPhrase, privateKey } = req.body;

                if (privateKey) {
                    await this.blockchain.setAccount(privateKey);
                    this.wallet = this.blockchain.currentAccount;
                } else if (seedPhrase) {
                    let testPrivateKey;

                    if (this.detectedNetwork === 'sepolia') {
                        // Pour Sepolia, utilise les seed phrases pour mapper aux bonnes clés
                        const sepoliaWallets = {
                            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about": "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
                            "test test test test test test test test test test test junk": "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
                            "legal winner thank year wave sausage worth useful legal winner thank yellow": "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
                            "letter advice cage absurd amount doctor acoustic avoid letter advice cage above": "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"
                        };
                        
                        testPrivateKey = sepoliaWallets[seedPhrase];
                        
                        if (!testPrivateKey) {
                            // Charge les wallets depuis le fichier de déploiement
                            try {
                                const deploymentInfo = Utils.loadDeploymentInfo('sepolia');
                                if (deploymentInfo.testWallets) {
                                    const matchingWallet = deploymentInfo.testWallets.find(w => 
                                        w.mnemonic && w.mnemonic.phrase === seedPhrase
                                    );
                                    if (matchingWallet) {
                                        testPrivateKey = matchingWallet.privateKey;
                                    }
                                }
                            } catch (error) {
                                console.log('Could not load Sepolia test wallets:', error.message);
                            }
                        }
                        
                        if (!testPrivateKey) {
                            throw new Error(`Seed phrase not recognized for Sepolia. Available test phrases:
                            - "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
                            - "test test test test test test test test test test test junk"
                            Or check deployments/sepolia-test-wallets.json for more wallets.`);
                        }
                        
                    } else if (this.detectedNetwork === 'localhost') {
                        // Pour localhost, utilise l'ancienne logique basée sur le port
                        if (this.port === 2001) {
                            testPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
                        } else if (this.port === 2002) {
                            testPrivateKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
                        } else if (this.port === 2003) {
                            testPrivateKey = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
                        } else {
                            testPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
                        }
                    } else {
                        // Pour autres réseaux, utilise le premier wallet par défaut
                        testPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
                        console.log(`⚠️  Using default wallet for ${this.detectedNetwork}. Consider providing specific private key.`);
                    }

                    await this.blockchain.setAccount(testPrivateKey);
                    this.wallet = this.blockchain.currentAccount;
                } else {
                    throw new Error('No privateKey or seedPhrase provided');
                }

                const networkInfo = this.blockchain.getNetworkInfo();
                
                console.log(`🔐 Wallet imported on ${this.detectedNetwork}:`);
                console.log(`   Address: ${Utils.formatAddress(this.wallet.address)}`);
                console.log(`   Port: ${this.port}`);
                console.log(`   Network: ${networkInfo.network}`);

                // Informations d'aide selon le réseau
                const helpInfo = this.getWalletHelpInfo();

                res.json({
                    success: true,
                    address: this.wallet.address,
                    network: this.detectedNetwork,
                    chainId: networkInfo.chainId,
                    port: this.port,
                    message: `Wallet imported successfully on ${this.detectedNetwork}`,
                    helpInfo: helpInfo
                });
            } catch (error) {
                console.error('Import wallet error:', error.message);
                res.status(400).json({
                    success: false,
                    error: error.message,
                    network: this.detectedNetwork,
                    suggestions: this.getWalletErrorSuggestions(error.message)
                });
            }
        });

        // === BALANCES AVEC INFORMATIONS RÉSEAU ===

        this.app.get('/balance', async (req, res) => {
            try {
                if (!this.wallet) {
                    throw new Error('No wallet imported');
                }

                const walletBalance = await this.blockchain.getBalance();
                const channelBalance = this.getChannelBalance();
                const networkInfo = this.blockchain.getNetworkInfo();

                console.log(`Balance request for ${Utils.formatAddress(this.wallet.address)} on ${this.detectedNetwork}:`);
                console.log(`  Raw wallet balance: ${walletBalance.formatted} THD`);
                console.log(`  Channel locked: ${Utils.formatBalance(channelBalance.locked)} THD`);
                console.log(`  Channel balance: ${Utils.formatBalance(channelBalance.balance)} THD`);

                const availableBalance = walletBalance.balance;
                const lockedBalance = channelBalance.locked;
                const totalBalance = availableBalance + lockedBalance;

                // Obtenir le solde ETH pour les frais
                let ethBalance = '0';
                try {
                    const ethBalanceWei = await this.blockchain.web3.eth.getBalance(this.wallet.address);
                    ethBalance = this.blockchain.web3.utils.fromWei(ethBalanceWei, 'ether');
                } catch (error) {
                    console.log('Could not fetch ETH balance:', error.message);
                }

                res.json({
                    success: true,
                    address: walletBalance.address,
                    network: this.detectedNetwork,
                    chainId: networkInfo.chainId,
                    totalTHD: Utils.formatBalance(totalBalance),
                    availableTHD: Utils.formatBalance(availableBalance),
                    channelTHD: Utils.formatBalance(lockedBalance),
                    channelBalance: Utils.formatBalance(channelBalance.balance),
                    ethBalance: parseFloat(ethBalance).toFixed(6) + ' ETH',
                    networkInfo: {
                        name: this.detectedNetwork,
                        explorer: networkInfo.explorer,
                        nativeCurrency: Utils.getNetworkInfo(networkInfo.chainId).nativeCurrency
                    },
                    recommendations: this.getBalanceRecommendations(ethBalance)
                });
            } catch (error) {
                console.error('Balance error:', error.message);
                res.status(400).json({
                    success: false,
                    error: error.message,
                    network: this.detectedNetwork,
                    suggestions: this.getBalanceErrorSuggestions(error.message)
                });
            }
        });

        // === CONNEXIONS P2P ===

        this.app.post('/connect', async (req, res) => {
            try {
                const { host, port } = req.body;

                if (!this.p2pManager) {
                    throw new Error('P2P manager not initialized');
                }

                await this.p2pManager.connectToPeer(host, port);

                res.json({
                    success: true,
                    message: `Connected to ${host}:${port}`,
                    peer: `${host}:${port}`,
                    network: this.detectedNetwork,
                    globalConnectivity: this.detectedNetwork !== 'localhost',
                    bidirectionalSupport: true
                });
            } catch (error) {
                console.error('Connect error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message,
                    network: this.detectedNetwork,
                    suggestions: this.getConnectionErrorSuggestions(error.message)
                });
            }
        });

        // === WORKFLOW P2P BIDIRECTIONNEL (identique mais avec informations réseau) ===

        this.app.post('/proposechannel', async (req, res) => {
            try {
                if (!this.wallet) {
                    throw new Error('No wallet imported');
                }

                if (!this.p2pManager) {
                    throw new Error('P2P manager not initialized');
                }

                const { peerAddress, amount = '10' } = req.body;

                if (this.p2pManager.getPeers().length === 0) {
                    throw new Error('No peers connected. Connect to a peer first.');
                }

                const amountWei = this.blockchain.web3.utils.toWei(amount, 'ether');

                console.log(`🔍 Determining acceptor for proposal on ${this.detectedNetwork}...`);
                console.log(`   Proposer (current user): ${Utils.formatAddress(this.wallet.address)}`);
                console.log(`   Target peer: ${peerAddress}`);

                // Détermine l'acceptor selon le réseau et le port du peer
                let acceptorAddress;

                if (this.detectedNetwork === 'localhost') {
                    // Localhost: logique par port
                    if (peerAddress.includes(':2001')) {
                        acceptorAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
                    } else if (peerAddress.includes(':2002')) {
                        acceptorAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
                    } else if (peerAddress.includes(':2003')) {
                        acceptorAddress = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
                    } else {
                        acceptorAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
                    }
                } else {
                    // Réseaux publics: utilise les adresses des wallets de test
                    const testWallets = Utils.getTestWallets(this.detectedNetwork);
                    if (testWallets.length > 1) {
                        // Utilise un wallet différent du proposer
                        const acceptorWallet = testWallets.find(w => 
                            w.address.toLowerCase() !== this.wallet.address.toLowerCase()
                        );
                        acceptorAddress = acceptorWallet ? acceptorWallet.address : "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
                    } else {
                        acceptorAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
                    }
                }

                console.log(`   Determined acceptor: ${Utils.formatAddress(acceptorAddress)}`);

                if (this.wallet.address.toLowerCase() === acceptorAddress.toLowerCase()) {
                    throw new Error('Cannot propose a channel to yourself. Connect to a different peer with a different wallet.');
                }

                const proposal = this.channelManager.createChannelProposal(
                    this.wallet.address,
                    acceptorAddress,
                    amountWei
                );

                this.p2pManager.registerProposalPeer(proposal.id, peerAddress, 'outgoing');

                console.log(`📤 Sending proposal ${proposal.id} to ${peerAddress} on ${this.detectedNetwork}...`);

                await this.p2pManager.sendMessage(peerAddress, 'CHANNEL_PROPOSAL', proposal);

                res.json({
                    success: true,
                    message: `Channel proposal sent to ${peerAddress}`,
                    proposal: {
                        id: proposal.id,
                        amount: amount,
                        peer: peerAddress,
                        status: proposal.status,
                        proposer: Utils.formatAddress(proposal.proposer),
                        acceptor: Utils.formatAddress(proposal.acceptor),
                        network: this.detectedNetwork,
                        bidirectional: true
                    }
                });
            } catch (error) {
                console.error('Propose channel error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message,
                    network: this.detectedNetwork
                });
            }
        });

        // Accepter une proposition
        this.app.post('/acceptchannel', async (req, res) => {
            try {
                if (!this.wallet) {
                    throw new Error('No wallet imported');
                }

                const { proposalId } = req.body;

                const proposal = this.channelManager.acceptChannelProposal(proposalId, this.wallet.address);

                if (this.p2pManager) {
                    try {
                        const proposalMapping = this.p2pManager.getPeerForProposal(proposalId);
                        let targetPeer = null;

                        if (proposalMapping) {
                            targetPeer = proposalMapping.peer;
                            console.log(`📋 Found peer via bidirectional mapping: ${targetPeer}`);
                        } else {
                            const originalProposal = this.p2pManager.getProposal(proposalId);
                            if (originalProposal && originalProposal.peer) {
                                targetPeer = originalProposal.peer;
                                console.log(`📋 Found peer via P2P proposal: ${targetPeer}`);
                            }
                        }

                        if (targetPeer) {
                            await this.p2pManager.sendMessage(targetPeer, 'CHANNEL_ACCEPTED', {
                                proposalId,
                                acceptor: this.wallet.address,
                                network: this.detectedNetwork,
                                timestamp: new Date().toISOString()
                            });
                            console.log(`📤 Notified proposer about acceptance on ${this.detectedNetwork}`);
                        } else {
                            console.error('❌ No peer found to notify about acceptance');
                        }
                    } catch (p2pError) {
                        console.error('Failed to notify proposer:', p2pError.message);
                    }
                }

                const serializedProposal = {
                    ...proposal,
                    amount: proposal.amount.toString(),
                    network: this.detectedNetwork
                };

                res.json({
                    success: true,
                    message: `Channel proposal ${proposalId} accepted`,
                    proposal: serializedProposal,
                    network: this.detectedNetwork
                });
            } catch (error) {
                console.error('Accept channel error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message,
                    network: this.detectedNetwork
                });
            }
        });

        // Créer le channel à partir d'une proposition
        this.app.post('/createchannel', async (req, res) => {
            try {
                if (!this.wallet) {
                    throw new Error('No wallet imported');
                }

                const { proposalId } = req.body;

                console.log(`🔓 Creating channel from proposal ${proposalId} on ${this.detectedNetwork}...`);

                const channel = await this.channelManager.createChannelFromProposal(proposalId);

                if (this.p2pManager) {
                    try {
                        console.log(`🔍 Looking up peer for proposal ${proposalId}...`);

                        const proposalMapping = this.p2pManager.getPeerForProposal(proposalId);
                        let targetPeer = null;

                        if (proposalMapping) {
                            targetPeer = proposalMapping.peer;
                            console.log(`📋 Found peer via bidirectional mapping: ${targetPeer} (${proposalMapping.direction})`);
                        } else {
                            const p2pProposal = this.p2pManager.getProposal(proposalId);
                            if (p2pProposal?.peer) {
                                targetPeer = p2pProposal.peer;
                                console.log(`📋 Found peer via P2P proposal: ${targetPeer}`);
                            } else {
                                const connectedPeers = this.p2pManager.getPeers();
                                if (connectedPeers.length > 0) {
                                    targetPeer = `${connectedPeers[0].host}:${connectedPeers[0].port}`;
                                    console.log(`📡 Using fallback peer: ${targetPeer}`);
                                }
                            }
                        }

                        if (targetPeer) {
                            console.log(`📤 Notifying peer ${targetPeer} about channel creation...`);

                            await this.p2pManager.sendMessage(targetPeer, 'CHANNEL_CREATED', {
                                proposalId,
                                channelId: channel.id,
                                channelAddress: channel.address,
                                partA: channel.partA,
                                partB: channel.partB,
                                amount: channel.amount.toString(),
                                network: this.detectedNetwork,
                                timestamp: new Date().toISOString()
                            });

                            console.log(`✅ Successfully notified peer about channel creation`);
                        } else {
                            console.error('❌ CRITICAL: No peer found to notify about channel creation');
                        }
                    } catch (p2pError) {
                        console.error('❌ Failed to notify peer about channel creation:', p2pError.message);
                    }
                }

                res.json({
                    success: true,
                    message: `Channel created from proposal ${proposalId}`,
                    channel: {
                        id: channel.id,
                        address: channel.address,
                        state: channel.state,
                        network: this.detectedNetwork,
                        needsFunding: true
                    },
                    debug: {
                        proposalId: proposalId,
                        notificationSent: !!this.p2pManager && this.p2pManager.getPeers().length > 0,
                        peersConnected: this.p2pManager ? this.p2pManager.getPeers().length : 0,
                        networkType: this.detectedNetwork
                    }
                });
            } catch (error) {
                console.error('Create channel error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message,
                    network: this.detectedNetwork
                });
            }
        });

        // Financer sa part du channel
        this.app.post('/fundchannel', async (req, res) => {
            try {
                if (!this.wallet) {
                    throw new Error('No wallet imported');
                }

                const { channelId } = req.body;

                console.log(`💰 Funding channel ${channelId} by ${Utils.formatAddress(this.wallet.address)} on ${this.detectedNetwork}...`);

                const result = await this.channelManager.fundChannelByUser(channelId, this.wallet.address);

                if (this.p2pManager && result.funded) {
                    try {
                        await this.p2pManager.broadcastMessage('CHANNEL_FUNDED', {
                            channelId,
                            userAddress: this.wallet.address,
                            bothFunded: result.bothFunded,
                            channelState: result.channelState,
                            network: this.detectedNetwork,
                            timestamp: new Date().toISOString()
                        });
                        console.log(`📤 Broadcasted funding notification on ${this.detectedNetwork}`);
                    } catch (p2pError) {
                        console.error('Failed to broadcast funding notification:', p2pError.message);
                    }
                }

                res.json({
                    success: true,
                    message: result.bothFunded
                        ? 'Channel fully funded and ACTIVE!'
                        : 'Your part funded. Waiting for other party.',
                    funded: true,
                    bothFunded: result.bothFunded,
                    channelState: result.channelState,
                    network: this.detectedNetwork
                });
            } catch (error) {
                console.error('Fund channel error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message,
                    network: this.detectedNetwork
                });
            }
        });

        // Lister les propositions
        this.app.get('/proposals', (req, res) => {
            try {
                const proposals = this.channelManager ? this.channelManager.getProposals() : [];

                const serializedProposals = proposals.map(proposal => ({
                    ...proposal,
                    amount: proposal.amount.toString(),
                    network: this.detectedNetwork
                }));

                res.json({
                    success: true,
                    proposals: serializedProposals,
                    network: this.detectedNetwork,
                    bidirectionalSupport: true,
                    count: serializedProposals.length
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message,
                    network: this.detectedNetwork
                });
            }
        });

        // === PAIEMENTS ===

        this.app.post('/pay', async (req, res) => {
            try {
                const { amount } = req.body;

                if (!amount) {
                    throw new Error('Amount is required');
                }

                const channels = this.channelManager.getChannels();
                const activeChannel = channels.find(c => c.state === 'ACTIVE');

                if (!activeChannel) {
                    throw new Error('No active channel found. Available channels: ' +
                        channels.map(c => `${c.id}(${c.state})`).join(', '));
                }

                const amountWei = this.blockchain.web3.utils.toWei(amount, 'ether');
                const payment = await this.channelManager.createOffChainPayment(activeChannel.id, amountWei);

                if (this.p2pManager) {
                    try {
                        console.log(`📤 Broadcasting payment to peers on ${this.detectedNetwork}...`);
                        await this.p2pManager.broadcastMessage('PAYMENT', {
                            channelId: activeChannel.id,
                            paymentId: payment.id,
                            amount: amountWei.toString(),
                            nonce: payment.nonce,
                            balanceA: payment.balanceA.toString(),
                            balanceB: payment.balanceB.toString(),
                            signature: payment.signature,
                            from: payment.from,
                            to: payment.to,
                            network: this.detectedNetwork,
                            timestamp: payment.timestamp
                        });
                        console.log(`✅ Payment broadcasted to peers on ${this.detectedNetwork}`);
                    } catch (p2pError) {
                        console.error('Failed to broadcast payment:', p2pError.message);
                    }
                }

                res.json({
                    success: true,
                    message: `Payment of ${amount} THD sent`,
                    payment: {
                        id: payment.id,
                        amount: amount,
                        nonce: payment.nonce,
                        network: this.detectedNetwork
                    }
                });
            } catch (error) {
                console.error('Payment error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message,
                    network: this.detectedNetwork
                });
            }
        });

        // === FERMETURE & RETRAIT ===

        this.app.post('/closechannel', async (req, res) => {
            try {
                const channels = this.channelManager.getChannels();
                const activeChannel = channels.find(c => c.state === 'ACTIVE');

                if (!activeChannel) {
                    const closingChannels = channels.filter(c => c.state === 'CLOSING');
                    if (closingChannels.length > 0) {
                        const closingChannel = closingChannels[0];
                        return res.status(400).json({
                            success: false,
                            error: `Channel ${closingChannel.id} is already in CLOSING state. It was closed by the other party. Use 'thunder-cli withdraw' after the challenge period expires.`,
                            channelState: 'CLOSING',
                            channelId: closingChannel.id,
                            network: this.detectedNetwork,
                            suggestion: 'withdraw'
                        });
                    }

                    const closedChannels = channels.filter(c => c.state === 'CLOSED');
                    if (closedChannels.length > 0) {
                        return res.status(400).json({
                            success: false,
                            error: `All channels are already closed. Funds have been distributed. Check your balance.`,
                            channelState: 'CLOSED',
                            network: this.detectedNetwork,
                            suggestion: 'balance'
                        });
                    }

                    throw new Error('No active channel found. Available channels: ' +
                        channels.map(c => `${c.id}(${c.state})`).join(', '));
                }

                console.log(`🔒 Closing channel ${activeChannel.id} via API on ${this.detectedNetwork}...`);

                const receipt = await this.channelManager.closeChannel(activeChannel.id);

                res.json({
                    success: true,
                    message: 'Channel closing initiated',
                    blockNumber: Number(receipt.blockNumber),
                    challengePeriod: 24,
                    network: this.detectedNetwork,
                    transactionHash: receipt.transactionHash,
                    p2pNotified: !!(this.channelManager && this.channelManager.p2pManager)
                });
            } catch (error) {
                console.error('Close channel error:', error);

                if (error.message.includes('already CLOSING')) {
                    res.status(400).json({
                        success: false,
                        error: error.message,
                        channelState: 'CLOSING',
                        network: this.detectedNetwork,
                        suggestion: 'wait_and_withdraw',
                        nextSteps: [
                            'Wait for challenge period to expire',
                            'Use: thunder-cli withdraw',
                            'Or speed up: npm run mine-blocks 25'
                        ]
                    });
                } else if (error.message.includes('already CLOSED')) {
                    res.status(400).json({
                        success: false,
                        error: error.message,
                        channelState: 'CLOSED',
                        network: this.detectedNetwork,
                        suggestion: 'check_balance',
                        nextSteps: [
                            'Check your balance: thunder-cli balance',
                            'Funds should already be in your wallet'
                        ]
                    });
                } else {
                    res.status(400).json({
                        success: false,
                        error: error.message,
                        network: this.detectedNetwork
                    });
                }
            }
        });

        this.app.post('/withdraw', async (req, res) => {
            try {
                const channels = this.channelManager.getChannels();
                let targetChannel = null;

                targetChannel = channels.find(c => c.state === 'CLOSING');

                if (!targetChannel) {
                    targetChannel = channels.find(c => c.state === 'CLOSED');

                    if (targetChannel) {
                        console.log(`💳 Found CLOSED channel: ${targetChannel.id}`);

                        return res.json({
                            success: true,
                            message: 'Channel is already closed - funds were distributed when the other party withdrew',
                            channelId: targetChannel.id,
                            channelState: 'CLOSED',
                            network: this.detectedNetwork,
                            status: 'already-distributed',
                            explanation: {
                                what_happened: 'The other party withdrew first, which automatically closed the channel and distributed all funds',
                                your_funds: 'Your THD tokens should already be in your wallet',
                                next_step: 'Check your balance with: thunder-cli balance'
                            },
                            p2pNotified: false
                        });
                    }

                    const availableChannels = channels.map(c => `${c.id}(${c.state})`).join(', ');
                    return res.status(400).json({
                        success: false,
                        error: 'No channel available for withdrawal',
                        availableChannels: availableChannels || 'none',
                        network: this.detectedNetwork,
                        suggestion: 'create_channel',
                        nextSteps: [
                            'Create a new channel: thunder-cli proposechannel <peer> <amount>',
                            'Or check your balance: thunder-cli balance'
                        ]
                    });
                }

                console.log(`💳 Withdrawing from CLOSING channel ${targetChannel.id} via API on ${this.detectedNetwork}...`);

                const result = await this.channelManager.withdrawFromChannel(targetChannel.id);

                if (result.status === 'already-distributed') {
                    return res.json({
                        success: true,
                        message: 'Funds were already distributed when the other party withdrew',
                        channelId: targetChannel.id,
                        transactionHash: result.transactionHash,
                        status: result.status,
                        network: this.detectedNetwork,
                        userFinalBalance: result.userFinalBalance,
                        explanation: {
                            what_happened: 'The other party completed withdrawal first',
                            your_funds: 'Your tokens were automatically distributed to your wallet',
                            check_balance: 'thunder-cli balance'
                        },
                        p2pNotified: false
                    });
                }

                if (result.status === 'no-funds') {
                    return res.json({
                        success: true,
                        message: 'No funds to withdraw - your final balance is 0 THD',
                        channelId: targetChannel.id,
                        status: result.status,
                        network: this.detectedNetwork,
                        userFinalBalance: '0',
                        p2pNotified: false
                    });
                }

                res.json({
                    success: true,
                    message: 'Funds withdrawn successfully',
                    transactionHash: result.transactionHash,
                    channelId: targetChannel.id,
                    channelState: 'CLOSED',
                    network: this.detectedNetwork,
                    p2pNotified: !!(this.channelManager && this.channelManager.p2pManager)
                });

            } catch (error) {
                console.error('Withdraw error:', error.message);

                if (error.message.includes('Challenge period not expired')) {
                    res.status(400).json({
                        success: false,
                        error: error.message,
                        channelState: 'CLOSING',
                        network: this.detectedNetwork,
                        suggestion: 'wait_or_mine_blocks',
                        nextSteps: [
                            'Wait for the challenge period to expire naturally',
                            'Or speed up with: npm run mine-blocks 25',
                            'Then try again: thunder-cli withdraw'
                        ]
                    });
                } else if (error.message.includes('already CLOSED')) {
                    res.status(400).json({
                        success: false,
                        error: 'Channel already closed and funds distributed',
                        channelState: 'CLOSED',
                        network: this.detectedNetwork,
                        suggestion: 'check_balance',
                        explanation: 'The other party withdrew first, which automatically distributed all funds',
                        nextSteps: [
                            'Check your balance: thunder-cli balance',
                            'Your THD tokens should be in your wallet',
                            'No further action needed'
                        ]
                    });
                } else {
                    res.status(400).json({
                        success: false,
                        error: error.message,
                        network: this.detectedNetwork,
                        timestamp: new Date().toISOString()
                    });
                }
            }
        });

        // === P2P MESSAGE HANDLING ===

        this.app.post('/p2p/message', (req, res) => {
            try {
                const message = req.body;
                const fromPeer = message.from;

                console.log(`📨 P2P message received: ${message.type} from ${fromPeer} on ${this.detectedNetwork}`);

                if (this.p2pManager) {
                    this.p2pManager.handleMessage(message, fromPeer);
                } else {
                    console.error('❌ P2P Manager not available to handle message');
                }

                res.json({
                    success: true,
                    received: true,
                    network: this.detectedNetwork,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error('P2P message error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message,
                    network: this.detectedNetwork
                });
            }
        });

        // === RÉTROCOMPATIBILITÉ ===

        this.app.post('/openchannel', async (req, res) => {
            try {
                console.log(`⚠️  Using deprecated openchannel endpoint on ${this.detectedNetwork}`);

                if (!this.wallet) {
                    throw new Error('No wallet imported');
                }

                const { amount = '10' } = req.body;
                const amountWei = this.blockchain.web3.utils.toWei(amount, 'ether');

                console.log(`Opening channel with ${amount} THD (${amountWei} wei) - DEPRECATED METHOD on ${this.detectedNetwork}`);

                const partB = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

                const proposal = this.channelManager.createChannelProposal(
                    this.wallet.address,
                    partB,
                    amountWei
                );

                this.channelManager.acceptChannelProposal(proposal.id, partB);
                const channel = await this.channelManager.createChannelFromProposal(proposal.id);

                await this.simulateBothPartiesFunding(channel.id);

                res.json({
                    success: true,
                    message: `Channel opened with ${amount} THD (deprecated method)`,
                    warning: 'This method is deprecated. Use the new P2P workflow for better security.',
                    channel: {
                        id: channel.id,
                        address: channel.address,
                        amount: amount,
                        state: channel.state,
                        network: this.detectedNetwork
                    }
                });
            } catch (error) {
                console.error('Open channel error (deprecated):', error);
                res.status(400).json({
                    success: false,
                    error: error.message,
                    network: this.detectedNetwork
                });
            }
        });

        // === ERROR HANDLER ===

        this.app.use((error, req, res, next) => {
            console.error('Express error:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                network: this.detectedNetwork,
                timestamp: new Date().toISOString()
            });
        });
    }

    // === MÉTHODES UTILITAIRES SPÉCIFIQUES AU RÉSEAU ===

    /**
     * Obtient les détails du réseau actuel
     */
    getNetworkDetails() {
        const networkInfo = this.blockchain.getNetworkInfo();
        const details = Utils.getNetworkInfo(networkInfo.chainId);
        
        return {
            name: this.detectedNetwork,
            chainId: networkInfo.chainId,
            explorer: details.explorer,
            nativeCurrency: details.nativeCurrency,
            rpcUrl: this.rpcUrl,
            faucets: details.faucets || [],
            isTestnet: ['sepolia', 'localhost'].includes(this.detectedNetwork),
            isPublic: !['localhost'].includes(this.detectedNetwork)
        };
    }

    /**
     * Obtient les liens d'aide selon le réseau
     */
    getHelpLinks() {
        const links = {
            localhost: {
                docs: 'README.md',
                setup: 'Start Hardhat: npm run node',
                deploy: 'Deploy: npm run deploy'
            },
            sepolia: {
                docs: 'SEPOLIA_SETUP.md',
                faucet: 'https://sepoliafaucet.com/',
                explorer: 'https://sepolia.etherscan.io/',
                rpc: 'https://chainlist.org/chain/11155111'
            },
            mainnet: {
                explorer: 'https://etherscan.io/',
                docs: 'README.md',
                warning: 'Use real ETH - no test funds available'
            }
        };
        
        return links[this.detectedNetwork] || links.localhost;
    }

    /**
     * Obtient les recommandations réseau
     */
    getNetworkRecommendations() {
        const recommendations = {
            localhost: [
                'Start Hardhat node: npm run node',
                'Deploy contracts: npm run deploy',
                'Use for development only'
            ],
            sepolia: [
                'Get test ETH: https://sepoliafaucet.com/',
                'Use Infura/Alchemy for better performance',
                'Perfect for public testing'
            ],
            mainnet: [
                'Use hardware wallet for security',
                'Test thoroughly on testnet first',
                'Monitor gas prices'
            ]
        };
        
        return recommendations[this.detectedNetwork] || [];
    }

    /**
     * Obtient les informations d'aide pour le wallet
     */
    getWalletHelpInfo() {
        if (this.detectedNetwork === 'sepolia') {
            return {
                testWallets: [
                    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
                    'test test test test test test test test test test test junk'
                ],
                faucet: 'https://sepoliafaucet.com/',
                explorer: 'https://sepolia.etherscan.io/'
            };
        } else if (this.detectedNetwork === 'localhost') {
            return {
                testWallets: ['Any Hardhat default wallet'],
                setup: 'npm run node && npm run deploy'
            };
        }
        
        return {
            warning: 'Use only test wallets on ' + this.detectedNetwork
        };
    }

    /**
     * Obtient les suggestions d'erreur pour le wallet
     */
    getWalletErrorSuggestions(errorMessage) {
        const suggestions = [];
        
        if (errorMessage.includes('not recognized')) {
            if (this.detectedNetwork === 'sepolia') {
                suggestions.push('Use a test seed phrase for Sepolia');
                suggestions.push('Check deployments/sepolia-test-wallets.json');
                suggestions.push('Deploy contracts first: npm run deploy:sepolia');
            }
        }
        
        if (errorMessage.includes('No wallet')) {
            suggestions.push('Import a wallet first');
            suggestions.push('Use: thunder-cli importwallet "<seed phrase>"');
        }
        
        return suggestions;
    }

    /**
     * Obtient les recommandations de balance
     */
    getBalanceRecommendations(ethBalance) {
        const recommendations = [];
        const ethNum = parseFloat(ethBalance);
        
        if (this.detectedNetwork === 'sepolia' && ethNum < 0.001) {
            recommendations.push('Low ETH balance for gas fees');
            recommendations.push('Get test ETH: https://sepoliafaucet.com/');
        } else if (this.detectedNetwork === 'mainnet' && ethNum < 0.01) {
            recommendations.push('Consider getting more ETH for gas fees');
        }
        
        return recommendations;
    }

    /**
     * Obtient les suggestions d'erreur de balance
     */
    getBalanceErrorSuggestions(errorMessage) {
        const suggestions = [];
        
        if (errorMessage.includes('not available')) {
            suggestions.push('Deploy contracts first');
            if (this.detectedNetwork === 'sepolia') {
                suggestions.push('npm run deploy:sepolia');
            } else {
                suggestions.push('npm run deploy');
            }
        }
        
        return suggestions;
    }

    /**
     * Obtient les suggestions d'erreur de connexion
     */
    getConnectionErrorSuggestions(errorMessage) {
        const suggestions = [];
        
        if (errorMessage.includes('connect')) {
            suggestions.push('Check if peer is running');
            suggestions.push('Verify network connectivity');
            if (this.detectedNetwork !== 'localhost') {
                suggestions.push('Ensure firewall allows connections');
                suggestions.push('Check if peer port is open');
            }
        }
        
        return suggestions;
    }

    // === SOCKET.IO HANDLERS ===

    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`🔌 Socket connected: ${socket.id} on ${this.detectedNetwork}`);

            socket.on('disconnect', () => {
                console.log(`🔌 Socket disconnected: ${socket.id}`);
            });

            socket.on('peer-message', (data) => {
                console.log(`📨 Peer message received on ${this.detectedNetwork}:`, data);
                socket.broadcast.emit('peer-message', data);
            });
        });
    }

    // === UTILITAIRES ===

    /**
     * Calcule les balances dans les channels pour l'utilisateur actuel
     */
    getChannelBalance() {
        if (!this.channelManager || !this.wallet) {
            return { locked: BigInt(0), balance: BigInt(0) };
        }

        const result = this.channelManager.getChannelBalance(this.wallet.address);
        return result;
    }

    /**
     * Simulation du financement des deux parties (pour rétrocompatibilité)
     */
    async simulateBothPartiesFunding(channelId) {
        try {
            console.log(`🔄 Simulating both parties funding (deprecated method) on ${this.detectedNetwork}...`);

            await this.channelManager.fundChannelByUser(channelId, this.wallet.address);

            const channel = this.channelManager.channels.get(channelId);
            const partBKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
            const partBAccount = this.blockchain.web3.eth.accounts.privateKeyToAccount(partBKey);

            this.blockchain.web3.eth.accounts.wallet.add(partBAccount);

            const fundAmount = channel.amount / BigInt(2);
            const thdAbi = require('../../artifacts/contracts/THDToken.sol/THDToken.json').abi;
            const thdContract = new this.blockchain.web3.eth.Contract(
                thdAbi,
                this.blockchain.deploymentInfo.thdToken
            );

            await thdContract.methods.approve(channel.address, fundAmount.toString()).send({
                from: partBAccount.address,
                gas: 100000
            });

            await channel.contract.methods.fund().send({
                from: partBAccount.address,
                gas: 200000
            });

            console.log(`💰 Part B funded ${Utils.formatBalance(fundAmount)} THD to channel on ${this.detectedNetwork}`);

            const funding = this.channelManager.userFunding.get(channelId);
            funding[partBAccount.address.toLowerCase()] = true;

            const channelInfo = await channel.contract.methods.getChannelInfo().call();
            const newState = this.channelManager.mapContractState(channelInfo._state);

            channel.state = newState;
            channel.lastUpdate = new Date().toISOString();

            console.log(`📊 Channel state updated: ${newState} on ${this.detectedNetwork}`);

            if (newState === 'ACTIVE') {
                console.log(`✅ Both parties funding simulated successfully - Channel ACTIVE on ${this.detectedNetwork}`);
            }

            return {
                success: true,
                channelState: newState,
                fundingComplete: newState === 'ACTIVE'
            };

        } catch (error) {
            console.error(`❌ Failed to simulate both parties funding on ${this.detectedNetwork}:`, error.message);
            throw error;
        }
    }

    // === STARTUP AVEC SUPPORT MULTI-RÉSEAU ===

    async start() {
        try {
            console.log('⚡ Thunder Payment Channel Node');
            console.log('================================');
            console.log(`Version: 1.0.0-sepolia`);
            console.log(`Port: ${this.port}`);
            console.log(`RPC: ${this.rpcUrl}`);
            console.log(`Network: ${this.detectedNetwork.toUpperCase()}`);
            console.log('');

            // Vérifications spécifiques selon le réseau
            if (this.detectedNetwork === 'sepolia') {
                console.log('🌐 Sepolia Network Configuration');
                console.log('================================');
                
                if (!process.env.SEPOLIA_RPC_URL && this.rpcUrl.includes('127.0.0.1')) {
                    console.log('⚠️  Using localhost RPC but Sepolia network specified');
                    console.log('💡 Set SEPOLIA_RPC_URL in .env or use --rpc flag');
                }
                
                console.log('🔗 Useful Sepolia links:');
                console.log('   🚰 Faucet: https://sepoliafaucet.com/');
                console.log('   🔍 Explorer: https://sepolia.etherscan.io/');
                console.log('   📚 RPC List: https://chainlist.org/chain/11155111');
                console.log('');
            } else if (this.detectedNetwork === 'localhost') {
                console.log('💻 Local Development Configuration');
                console.log('==================================');
                console.log('   Ensure Hardhat node is running: npm run node');
                console.log('   Deploy contracts: npm run deploy');
                console.log('');
            } else if (this.detectedNetwork === 'mainnet') {
                console.log('🚨 MAINNET CONFIGURATION');
                console.log('========================');
                console.log('⚠️  You are connecting to MAINNET - use real ETH!');
                console.log('   Ensure you have tested thoroughly on testnet');
                console.log('   Use hardware wallet for security');
                console.log('');
            }

            // === ÉTAPE 1: INITIALISATION BLOCKCHAIN ===
            console.log('🔗 Step 1: Initializing blockchain connection...');
            await this.blockchain.initialize();
            
            this.networkInfo = this.blockchain.getNetworkInfo();
            console.log(`✅ Connected to ${this.networkInfo.network.toUpperCase()}`);

            // === ÉTAPE 2: INITIALISATION CHANNEL MANAGER ===
            console.log('📋 Step 2: Initializing channel manager...');
            this.channelManager = new ChannelManager(this.blockchain);
            console.log('✅ Channel manager initialized');

            // === ÉTAPE 3: INITIALISATION P2P MANAGER ===
            console.log('📡 Step 3: Initializing P2P manager...');
            this.p2pManager = new P2PManager(this, this.port);
            console.log('✅ P2P manager initialized');

            // === ÉTAPE 4: INJECTION P2P ===
            console.log('🔗 Step 4: Injecting P2P manager into channel manager...');
            this.channelManager.setP2PManager(this.p2pManager);
            
            if (this.channelManager.p2pManager) {
                console.log('✅ P2P Manager successfully injected');
                console.log('🔄 Channel closure synchronization: ENABLED');
            } else {
                throw new Error('Critical: P2P Manager injection failed');
            }

            // === ÉTAPE 5: VÉRIFICATION SUPPORT BIDIRECTIONNEL ===
            console.log('🔄 Step 5: Verifying bidirectional support...');
            if (this.p2pManager.proposalToPeerMap && this.p2pManager.peerToProposalsMap) {
                console.log('✅ Bidirectional proposal mapping: ENABLED');
            } else {
                throw new Error('Critical: Bidirectional proposal support missing');
            }

            // === ÉTAPE 6: DÉMARRAGE DU SERVEUR ===
            console.log('🚀 Step 6: Starting HTTP server...');
            this.server.listen(this.port, () => {
                console.log('\n🎉 Thunder Node Successfully Started!');
                console.log('=====================================');
                console.log(`🌐 Network: ${this.networkInfo.network.toUpperCase()}`);
                console.log(`🔗 HTTP Server: http://localhost:${this.port}`);
                console.log(`🔌 Socket.IO: ws://localhost:${this.port}`);
                console.log(`📡 P2P Port: ${this.port}`);
                
                if (this.networkInfo.explorer) {
                    console.log(`🔍 Explorer: ${this.networkInfo.explorer}`);
                }
                
                console.log('');
                console.log('🔧 System Status:');
                console.log(`   ✅ Blockchain: Connected to ${this.networkInfo.network}`);
                console.log(`   ✅ Channel Manager: Ready`);
                console.log(`   ✅ P2P Manager: Ready`);
                console.log(`   ✅ P2P Injection: Success`);
                console.log(`   ✅ Channel Sync: Enabled`);
                console.log(`   ✅ Bidirectional Proposals: Enabled`);
                console.log(`   ✅ Multi-Network Support: Enabled`);
                console.log('');
                
                // Instructions spécifiques selon le réseau
                if (this.detectedNetwork === 'sepolia') {
                    console.log('🎯 Ready for Sepolia testing!');
                    console.log('=============================');
                    console.log('Your node is now connected to the Sepolia testnet.');
                    console.log('Others can connect to you from anywhere in the world!');
                    console.log('');
                    console.log('📋 Next steps for global testing:');
                    console.log('1. Import a test wallet:');
                    console.log('   thunder-cli importwallet "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"');
                    console.log('');
                    console.log('2. Share your public IP with testers:');
                    console.log('   • Find your IP: curl ifconfig.me');
                    console.log('   • Open port in router/firewall');
                    console.log('   • Share: <YOUR_PUBLIC_IP>:' + this.port);
                    console.log('');
                    console.log('3. Connect with other testers worldwide:');
                    console.log('   thunder-cli connect <THEIR_IP>:2001');
                    console.log('');
                    console.log('4. Create payment channels:');
                    console.log('   thunder-cli proposechannel <THEIR_IP>:2001 10');
                    console.log('');
                    console.log('🌍 Global testing enabled! 🚀');
                    
                } else if (this.detectedNetwork === 'localhost') {
                    console.log('💻 Ready for local development!');
                    console.log('===============================');
                    console.log('1. Import wallet: thunder-cli importwallet "<seed phrase>"');
                    console.log('2. Start second node: thunderd --port 2002');
                    console.log('3. Connect nodes: thunder-cli connect localhost:2002');
                    console.log('4. Create channels: thunder-cli proposechannel localhost:2002 10');
                    
                } else if (this.detectedNetwork === 'mainnet') {
                    console.log('🚨 MAINNET MODE - REAL MONEY!');
                    console.log('=============================');
                    console.log('⚠️  You are on MAINNET - all transactions use real ETH!');
                    console.log('💡 Ensure thorough testing on testnet first');
                    console.log('🔒 Use hardware wallet for security');
                    console.log('📊 Monitor gas prices carefully');
                }
                
                console.log('');
                console.log('🔍 Debug endpoints:');
                console.log(`  - System info: curl http://localhost:${this.port}/debug/system`);
                console.log(`  - Network info: curl http://localhost:${this.port}/debug/network`);
                console.log(`  - Channels: curl http://localhost:${this.port}/debug/channels`);
                console.log(`  - P2P status: curl http://localhost:${this.port}/debug/p2p`);
            });

            return true;
        } catch (error) {
            console.error('\n❌ Failed to start Thunder server');
            console.error('==================================');
            console.error(`Error: ${error.message}`);
            console.error('');
            
            // Instructions spécifiques selon l'erreur et le réseau
            if (error.message.includes('connect') && this.rpcUrl) {
                console.error('💡 RPC Connection issues:');
                console.error(`   - Check RPC URL: ${this.rpcUrl}`);
                console.error('   - Verify internet connection');
                
                if (this.detectedNetwork === 'sepolia') {
                    console.error('   - Verify Sepolia RPC endpoint');
                    console.error('   - Check Infura/Alchemy API key');
                    console.error('   - Try: thunderd --rpc https://rpc.sepolia.org');
                } else if (this.detectedNetwork === 'localhost') {
                    console.error('   - Start Hardhat node: npm run node');
                }
            } else if (error.message.includes('deployment')) {
                console.error('💡 Deployment issues:');
                if (this.detectedNetwork === 'sepolia') {
                    console.error('   - Deploy contracts: npm run deploy:sepolia');
                    console.error('   - Check .env configuration');
                    console.error('   - Get test ETH: https://sepoliafaucet.com/');
                } else {
                    console.error('   - Deploy contracts: npm run deploy');
                    console.error('   - Start Hardhat: npm run node');
                }
            } else if (error.message.includes('injection')) {
                console.error('💡 P2P injection failed:');
                console.error('   - Check ChannelManager.setP2PManager() method');
                console.error('   - Verify no circular dependencies');
            }

            throw error;
        }
    }
}

module.exports = ThunderdServer;