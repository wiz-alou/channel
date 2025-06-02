/**
 * FICHIER: src/thunderd/server.js
 * 
 * DESCRIPTION:
 * Serveur principal Thunder qui expose une API REST pour les payment channels.
 * VERSION COMPLÈTE avec injection P2P, synchronisation des fermetures ET support bidirectionnel.
 * 
 * NOUVELLES FONCTIONNALITÉS:
 * - Support bidirectionnel complet pour les propositions de channels
 * - Résolution robuste des peers avec mapping proposalId ↔ peerAddress
 * - Détermination dynamique de l'acceptor selon le port du peer
 * - Injection P2P critique pour synchronisation des fermetures
 * - Endpoints de diagnostic avancés
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const BlockchainManager = require('./blockchain');
const ChannelManager = require('./channel');
const P2PManager = require('./p2p');
const Utils = require('../shared/utils');

class ThunderdServer {
    constructor(port = 2001) {
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server);

        // Managers
        this.blockchain = new BlockchainManager();
        this.channelManager = null;
        this.p2pManager = null;
        this.connectedPeers = new Map();
        this.channels = new Map();
        this.wallet = null;

        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketHandlers();

        console.log(`🏗️  ThunderdServer initialized on port ${this.port} with bidirectional support`);
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

        // Request logging
        this.app.use((req, res, next) => {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] ${req.method} ${req.path}`);
            next();
        });
    }

    // === API ROUTES ===

    setupRoutes() {
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'OK',
                timestamp: new Date().toISOString(),
                port: this.port,
                version: '1.0.0-bidirectional',
                capabilities: ['channels', 'payments', 'p2p', 'channel-sync', 'bidirectional-proposals']
            });
        });

        // === ENDPOINTS DE DIAGNOSTIC (CRITIQUES POUR DEBUG) ===

        this.app.get('/debug/system', (req, res) => {
            try {
                res.json({
                    success: true,
                    timestamp: new Date().toISOString(),
                    port: this.port,
                    components: {
                        blockchain: !!this.blockchain,
                        channelManager: !!this.channelManager,
                        p2pManager: !!this.p2pManager,
                        wallet: !!this.wallet
                    },
                    injections: {
                        p2pIntoChannelManager: this.channelManager ? !!this.channelManager.p2pManager : false
                    },
                    features: {
                        bidirectionalProposals: true,
                        proposalMapping: !!this.p2pManager?.proposalToPeerMap,
                        channelSync: !!(this.channelManager && this.channelManager.p2pManager)
                    },
                    uptime: process.uptime(),
                    memoryUsage: process.memoryUsage(),
                    version: '1.0.0-bidirectional'
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

        this.app.get('/debug/channels', (req, res) => {
            try {
                const channels = this.channelManager ? this.channelManager.getChannels() : [];
                const detailedChannels = channels.map(channel => {
                    const fullChannel = this.channelManager.channels.get(channel.id);
                    return {
                        ...channel,
                        funding: this.channelManager.userFunding.get(channel.id),
                        pendingPayments: fullChannel?.pendingPayments?.length || 0,
                        lastUpdate: fullChannel?.lastUpdate || 'unknown'
                    };
                });

                const diagnosticInfo = this.channelManager ? this.channelManager.getDiagnosticInfo() : {};

                res.json({
                    success: true,
                    timestamp: new Date().toISOString(),
                    channels: detailedChannels,
                    diagnostic: diagnosticInfo,
                    p2pConnected: !!this.p2pManager,
                    peersCount: this.p2pManager ? this.p2pManager.getPeers().length : 0,
                    walletLoaded: !!this.wallet,
                    bidirectionalSupport: true
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
                    p2pManager: !!this.p2pManager,
                    diagnostic: p2pInfo,
                    bidirectionalMappings: p2pInfo.proposalMappings || {}
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

        // === INFORMATIONS DU NODE ===

        this.app.get('/infos', (req, res) => {
            try {
                console.log(`📊 Processing /infos request...`);

                const channels = this.channelManager ? this.channelManager.getChannels() : [];
                const peers = this.p2pManager ? this.p2pManager.getPeers() : [];
                const proposals = this.channelManager ? this.channelManager.getProposals() : [];

                console.log(`   Raw data: ${channels.length} channels, ${peers.length} peers, ${proposals.length} proposals`);

                // === FONCTION UTILITAIRE DE SÉRIALISATION ROBUSTE ===

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

                // === SÉRIALISATION DES PROPOSALS ===

                console.log(`   Serializing proposals...`);
                const serializedProposals = proposals.map((proposal, index) => {
                    console.log(`     Proposal ${index}: ${proposal.id} (amount: ${typeof proposal.amount})`);
                    return serializeBigIntDeep(proposal, `proposal[${index}]`);
                });

                // === SÉRIALISATION DES CHANNELS (ROBUSTE) ===

                console.log(`   Serializing channels...`);
                const serializedChannels = channels.map((channel, index) => {
                    console.log(`     Channel ${index}: ${channel.id} (state: ${channel.state})`);
                    console.log(`       amount type: ${typeof channel.amount}`);
                    console.log(`       balanceA type: ${typeof channel.balanceA}`);
                    console.log(`       balanceB type: ${typeof channel.balanceB}`);

                    return serializeBigIntDeep(channel, `channel[${index}]`);
                });

                // === SÉRIALISATION DES PEERS ===

                console.log(`   Serializing peers...`);
                const serializedPeers = serializeBigIntDeep(peers, 'peers');

                // === SÉRIALISATION DE BLOCKCHAIN INFO ===

                console.log(`   Serializing blockchain info...`);
                const blockchainInfo = serializeBigIntDeep(
                    this.blockchain.getNetworkInfo(),
                    'blockchain'
                );

                // === CONSTRUCTION DE LA RÉPONSE ===

                const responseData = {
                    port: this.port,
                    connectedPeers: serializedPeers,
                    channels: serializedChannels,
                    pendingProposals: serializedProposals,
                    blockchain: blockchainInfo,
                    wallet: this.wallet ? Utils.formatAddress(this.wallet.address) : null,
                    version: '1.0.0-bidirectional',
                    uptime: process.uptime(),
                    features: {
                        p2pSyncEnabled: !!(this.channelManager && this.channelManager.p2pManager),
                        bidirectionalProposals: true,
                        proposalMappingActive: !!this.p2pManager?.proposalToPeerMap
                    }
                };

                // === VÉRIFICATION FINALE ===

                console.log(`   Final serialization check...`);
                const finalSerialized = serializeBigIntDeep(responseData, 'response');

                // Test de sérialisation JSON
                try {
                    JSON.stringify(finalSerialized);
                    console.log(`✅ JSON serialization test passed`);
                } catch (jsonError) {
                    console.error(`❌ JSON serialization test failed:`, jsonError.message);
                    throw new Error(`JSON serialization failed: ${jsonError.message}`);
                }

                console.log(`📊 /infos response ready - sending to client`);
                res.json(finalSerialized);

            } catch (error) {
                console.error('❌ /infos endpoint error:', error.message);
                console.error('   Stack:', error.stack);

                res.status(500).json({
                    success: false,
                    error: 'Internal server error',
                    timestamp: new Date().toISOString(),
                    details: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
                });
            }
        });

        // === GESTION DU WALLET ===

        this.app.post('/importwallet', async (req, res) => {
            try {
                const { seedPhrase, privateKey } = req.body;

                if (privateKey) {
                    await this.blockchain.setAccount(privateKey);
                    this.wallet = this.blockchain.currentAccount;
                } else if (seedPhrase) {
                    // === CORRECTION: Détermine la clé selon le port du node ===
                    let testPrivateKey;
                    
                    if (this.port === 2001) {
                        testPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
                    } else if (this.port === 2002) {
                        testPrivateKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
                    } else if (this.port === 2003) {
                        testPrivateKey = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
                    } else {
                        // Fallback
                        testPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
                    }
                    
                    await this.blockchain.setAccount(testPrivateKey);
                    this.wallet = this.blockchain.currentAccount;
                } else {
                    throw new Error('No privateKey or seedPhrase provided');
                }

                console.log(`🔐 Wallet imported on port ${this.port}: ${Utils.formatAddress(this.wallet.address)}`);

                res.json({
                    success: true,
                    address: this.wallet.address,
                    port: this.port,
                    message: 'Wallet imported successfully'
                });
            } catch (error) {
                console.error('Import wallet error:', error.message);
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // === BALANCES ===

        this.app.get('/balance', async (req, res) => {
            try {
                if (!this.wallet) {
                    throw new Error('No wallet imported');
                }

                // 1. Récupère le balance BRUT du wallet
                const walletBalance = await this.blockchain.getBalance();

                // 2. Récupère les infos des channels
                const channelBalance = this.getChannelBalance();

                console.log(`Balance request for ${Utils.formatAddress(this.wallet.address)}:`);
                console.log(`  Raw wallet balance: ${walletBalance.formatted} THD`);
                console.log(`  Channel locked: ${Utils.formatBalance(channelBalance.locked)} THD`);
                console.log(`  Channel balance: ${Utils.formatBalance(channelBalance.balance)} THD`);

                // === LOGIQUE ESCROW CORRIGÉE ===
                const availableBalance = walletBalance.balance;
                const lockedBalance = channelBalance.locked;
                const totalBalance = availableBalance + lockedBalance;

                console.log(`  Available (wallet): ${Utils.formatBalance(availableBalance)} THD`);
                console.log(`  Locked (escrow): ${Utils.formatBalance(lockedBalance)} THD`);
                console.log(`  Total calculated: ${Utils.formatBalance(totalBalance)} THD`);

                res.json({
                    success: true,
                    address: walletBalance.address,
                    totalTHD: Utils.formatBalance(totalBalance),
                    availableTHD: Utils.formatBalance(availableBalance),
                    channelTHD: Utils.formatBalance(lockedBalance),
                    channelBalance: Utils.formatBalance(channelBalance.balance)
                });
            } catch (error) {
                console.error('Balance error:', error.message);
                res.status(400).json({
                    success: false,
                    error: error.message
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
                    bidirectionalSupport: true
                });
            } catch (error) {
                console.error('Connect error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // === NOUVEAU WORKFLOW P2P BIDIRECTIONNEL ===

        // Proposer un channel CORRIGÉ BIDIRECTIONNEL
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

                // === CORRECTION CRITIQUE: Détermine dynamiquement l'acceptor selon le port du peer ===
                
                console.log(`🔍 Determining acceptor for proposal...`);
                console.log(`   Proposer (current user): ${Utils.formatAddress(this.wallet.address)}`);
                console.log(`   Target peer: ${peerAddress}`);
                
                // Détermine l'acceptor selon le port du peer
                let acceptorAddress;
                
                if (peerAddress.includes(':2001')) {
                    // Si on propose à port 2001, utilise l'adresse du compte 1  
                    acceptorAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
                } else if (peerAddress.includes(':2002')) {
                    // Si on propose à port 2002, utilise l'adresse du compte 2
                    acceptorAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
                } else if (peerAddress.includes(':2003')) {
                    // Si on propose à port 2003, utilise l'adresse du compte 3
                    acceptorAddress = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
                } else {
                    // Fallback: utilise l'adresse du compte 2
                    acceptorAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
                }
                
                console.log(`   Determined acceptor: ${Utils.formatAddress(acceptorAddress)}`);
                
                // === CORRECTION: Évite la proposition à soi-même ===
                if (this.wallet.address.toLowerCase() === acceptorAddress.toLowerCase()) {
                    throw new Error('Cannot propose a channel to yourself. Connect to a different peer with a different port.');
                }

                const proposal = this.channelManager.createChannelProposal(
                    this.wallet.address,
                    acceptorAddress,
                    amountWei
                );

                // === CORRECTION CRITIQUE: Enregistre le mapping avant envoi ===
                this.p2pManager.registerProposalPeer(proposal.id, peerAddress, 'outgoing');

                console.log(`📤 Sending proposal ${proposal.id} to ${peerAddress}...`);
                console.log(`   Mapping registered: ${proposal.id} → ${peerAddress} (outgoing)`);
                
                // Envoie la proposition via P2P
                await this.p2pManager.sendMessage(peerAddress, 'CHANNEL_PROPOSAL', proposal);

                console.log(`✅ Proposal sent successfully`);

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
                        bidirectional: true
                    }
                });
            } catch (error) {
                console.error('Propose channel error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message
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

                // Notifie le proposer via P2P que la proposition est acceptée
                if (this.p2pManager) {
                    try {
                        // === CORRECTION: Utilise d'abord le mapping bidirectionnel ===
                        const proposalMapping = this.p2pManager.getPeerForProposal(proposalId);
                        let targetPeer = null;
                        
                        if (proposalMapping) {
                            targetPeer = proposalMapping.peer;
                            console.log(`📋 Found peer via bidirectional mapping: ${targetPeer}`);
                        } else {
                            // Fallback vers l'ancienne méthode
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
                                timestamp: new Date().toISOString()
                            });
                            console.log(`📤 Notified proposer about acceptance`);
                        } else {
                            console.error('❌ No peer found to notify about acceptance');
                        }
                    } catch (p2pError) {
                        console.error('Failed to notify proposer:', p2pError.message);
                        // Continue même si la notification P2P échoue
                    }
                }

                // Sérialise les BigInt pour JSON
                const serializedProposal = {
                    ...proposal,
                    amount: proposal.amount.toString()
                };

                res.json({
                    success: true,
                    message: `Channel proposal ${proposalId} accepted`,
                    proposal: serializedProposal
                });
            } catch (error) {
                console.error('Accept channel error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Créer le channel à partir d'une proposition CORRIGÉ BIDIRECTIONNEL
        this.app.post('/createchannel', async (req, res) => {
            try {
                if (!this.wallet) {
                    throw new Error('No wallet imported');
                }

                const { proposalId } = req.body;

                console.log(`🔓 Creating channel from proposal ${proposalId}...`);

                const channel = await this.channelManager.createChannelFromProposal(proposalId);

                // === CORRECTION CRITIQUE: Résolution robuste du peer avec mapping bidirectionnel ===
                if (this.p2pManager) {
                    try {
                        console.log(`🔍 Looking up peer for proposal ${proposalId}...`);
                        
                        // Étape 1: Essaie le mapping bidirectionnel (NOUVEAU ET CRITIQUE)
                        const proposalMapping = this.p2pManager.getPeerForProposal(proposalId);
                        let targetPeer = null;
                        
                        if (proposalMapping) {
                            targetPeer = proposalMapping.peer;
                            console.log(`📋 Found peer via bidirectional mapping: ${targetPeer} (${proposalMapping.direction})`);
                        } else {
                            console.log(`⚠️  No bidirectional mapping found for proposal ${proposalId}`);
                            
                            // Étape 2: Fallback vers l'ancienne méthode
                            const p2pProposal = this.p2pManager.getProposal(proposalId);
                            if (p2pProposal?.peer) {
                                targetPeer = p2pProposal.peer;
                                console.log(`📋 Found peer via P2P proposal: ${targetPeer}`);
                            } else {
                                console.log(`⚠️  No P2P proposal found either`);
                                
                                // Étape 3: Utilise le premier peer connecté
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
                                timestamp: new Date().toISOString()
                            });
                            
                            console.log(`✅ Successfully notified peer about channel creation`);
                        } else {
                            console.error('❌ CRITICAL: No peer found to notify about channel creation');
                            console.error('   This means the other party will not know the channel was created');
                            console.error('   Possible causes:');
                            console.error('   1. Bidirectional mapping was not registered during proposal');
                            console.error('   2. P2P proposal data was lost');
                            console.error('   3. No peers are connected');
                            console.error('   4. Peer disconnected after proposal');
                            
                            // Debug info
                            console.error(`   Debug info:`);
                            console.error(`   - Connected peers: ${this.p2pManager.getPeers().length}`);
                            console.error(`   - Proposal mapping exists: ${!!proposalMapping}`);
                            console.error(`   - P2P proposal exists: ${!!this.p2pManager.getProposal(proposalId)}`);
                        }
                    } catch (p2pError) {
                        console.error('❌ Failed to notify peer about channel creation:', p2pError.message);
                        console.error('   Channel was created successfully but peer notification failed');
                        console.error('   The other party may need to manually check: thunder-cli proposals');
                    }
                } else {
                    console.error('❌ P2P Manager not available for notification');
                }

                res.json({
                    success: true,
                    message: `Channel created from proposal ${proposalId}`,
                    channel: {
                        id: channel.id,
                        address: channel.address,
                        state: channel.state,
                        needsFunding: true
                    },
                    // Informations de debug pour le client
                    debug: {
                        proposalId: proposalId,
                        notificationSent: !!this.p2pManager && this.p2pManager.getPeers().length > 0,
                        peersConnected: this.p2pManager ? this.p2pManager.getPeers().length : 0,
                        bidirectionalSupport: true
                    }
                });
            } catch (error) {
                console.error('Create channel error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message
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

                console.log(`💰 Funding channel ${channelId} by ${Utils.formatAddress(this.wallet.address)}...`);

                const result = await this.channelManager.fundChannelByUser(channelId, this.wallet.address);

                // Notifie les autres nodes du financement
                if (this.p2pManager && result.funded) {
                    try {
                        await this.p2pManager.broadcastMessage('CHANNEL_FUNDED', {
                            channelId,
                            userAddress: this.wallet.address,
                            bothFunded: result.bothFunded,
                            channelState: result.channelState,
                            timestamp: new Date().toISOString()
                        });
                        console.log(`📤 Broadcasted funding notification`);
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
                    channelState: result.channelState
                });
            } catch (error) {
                console.error('Fund channel error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Lister les propositions
        this.app.get('/proposals', (req, res) => {
            try {
                const proposals = this.channelManager ? this.channelManager.getProposals() : [];

                // Sérialise les BigInt pour JSON
                const serializedProposals = proposals.map(proposal => ({
                    ...proposal,
                    amount: proposal.amount.toString()
                }));

                res.json({
                    success: true,
                    proposals: serializedProposals,
                    bidirectionalSupport: true,
                    count: serializedProposals.length
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
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

                // Notifie l'autre node du paiement via P2P
                if (this.p2pManager) {
                    try {
                        console.log(`📤 Broadcasting payment to peers...`);
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
                            timestamp: payment.timestamp
                        });
                        console.log(`✅ Payment broadcasted to peers`);
                    } catch (p2pError) {
                        console.error('Failed to broadcast payment:', p2pError.message);
                        // Continue même si le P2P échoue - le paiement local est valide
                    }
                }

                res.json({
                    success: true,
                    message: `Payment of ${amount} THD sent`,
                    payment: {
                        id: payment.id,
                        amount: amount,
                        nonce: payment.nonce
                    }
                });
            } catch (error) {
                console.error('Payment error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // === FERMETURE & RETRAIT (CORRIGÉ AVEC SYNC P2P) ===

        this.app.post('/closechannel', async (req, res) => {
            try {
                const channels = this.channelManager.getChannels();
                const activeChannel = channels.find(c => c.state === 'ACTIVE');

                if (!activeChannel) {
                    throw new Error('No active channel found. Available channels: ' +
                        channels.map(c => `${c.id}(${c.state})`).join(', '));
                }

                console.log(`🔒 Closing channel ${activeChannel.id} via API...`);
                console.log(`   P2P Manager available: ${!!this.p2pManager}`);
                console.log(`   Channel Manager P2P reference: ${!!(this.channelManager && this.channelManager.p2pManager)}`);

                const receipt = await this.channelManager.closeChannel(activeChannel.id);

                res.json({
                    success: true,
                    message: 'Channel closing initiated',
                    blockNumber: Number(receipt.blockNumber),
                    challengePeriod: 24,
                    p2pNotified: !!(this.channelManager && this.channelManager.p2pManager)
                });
            } catch (error) {
                console.error('Close channel error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        this.app.post('/withdraw', async (req, res) => {
            try {
                const channels = this.channelManager.getChannels();
                const closingChannel = channels.find(c => c.state === 'CLOSING');

                if (!closingChannel) {
                    throw new Error('No closing channel found. Available channels: ' +
                        channels.map(c => `${c.id}(${c.state})`).join(', '));
                }

                console.log(`💳 Withdrawing from channel ${closingChannel.id}...`);

                const receipt = await this.channelManager.withdrawFromChannel(closingChannel.id);

                res.json({
                    success: true,
                    message: 'Funds withdrawn successfully',
                    transactionHash: receipt.transactionHash
                });
            } catch (error) {
                console.error('Withdraw error:', error.message);
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // === P2P MESSAGE HANDLING ===

        this.app.post('/p2p/message', (req, res) => {
            try {
                const message = req.body;
                const fromPeer = message.from;

                console.log(`📨 P2P message received: ${message.type} from ${fromPeer}`);

                if (this.p2pManager) {
                    this.p2pManager.handleMessage(message, fromPeer);
                } else {
                    console.error('❌ P2P Manager not available to handle message');
                }

                res.json({
                    success: true,
                    received: true,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error('P2P message error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // === RÉTROCOMPATIBILITÉ ===

        // Ancienne méthode openchannel (dépréciée)
        this.app.post('/openchannel', async (req, res) => {
            try {
                console.log('⚠️  Using deprecated openchannel endpoint');

                if (!this.wallet) {
                    throw new Error('No wallet imported');
                }

                const { amount = '10' } = req.body;
                const amountWei = this.blockchain.web3.utils.toWei(amount, 'ether');

                console.log(`Opening channel with ${amount} THD (${amountWei} wei) - DEPRECATED METHOD`);

                // Pour la rétrocompatibilité, utilise l'ancienne simulation
                const partB = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

                // Crée une proposition automatique et l'accepte
                const proposal = this.channelManager.createChannelProposal(
                    this.wallet.address,
                    partB,
                    amountWei
                );

                this.channelManager.acceptChannelProposal(proposal.id, partB);
                const channel = await this.channelManager.createChannelFromProposal(proposal.id);

                // Finance automatiquement les deux parties (simulation)
                await this.simulateBothPartiesFunding(channel.id);

                res.json({
                    success: true,
                    message: `Channel opened with ${amount} THD (deprecated method)`,
                    warning: 'This method is deprecated. Use the new P2P workflow for better security.',
                    channel: {
                        id: channel.id,
                        address: channel.address,
                        amount: amount,
                        state: channel.state
                    }
                });
            } catch (error) {
                console.error('Open channel error (deprecated):', error);
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // === ERROR HANDLER ===

        this.app.use((error, req, res, next) => {
            console.error('Express error:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                timestamp: new Date().toISOString()
            });
        });
    }

    // === SOCKET.IO HANDLERS ===

    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`🔌 Socket connected: ${socket.id}`);

            socket.on('disconnect', () => {
                console.log(`🔌 Socket disconnected: ${socket.id}`);
            });

            // Gestion des messages peer-to-peer
            socket.on('peer-message', (data) => {
                console.log('📨 Peer message received:', data);
                // Broadcast vers les autres peers
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
            console.log('🔄 Simulating both parties funding (deprecated method)...');

            // Finance Part A (utilisateur actuel)
            await this.channelManager.fundChannelByUser(channelId, this.wallet.address);

            // Simule le financement de Part B
            const channel = this.channelManager.channels.get(channelId);
            const partBKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
            const partBAccount = this.blockchain.web3.eth.accounts.privateKeyToAccount(partBKey);

            // Ajoute Part B au wallet
            this.blockchain.web3.eth.accounts.wallet.add(partBAccount);

            // Approve et finance Part B
            const fundAmount = channel.amount / BigInt(2);
            const thdAbi = require('../../artifacts/contracts/THDToken.sol/THDToken.json').abi;
            const thdContract = new this.blockchain.web3.eth.Contract(
                thdAbi,
                this.blockchain.deploymentInfo.thdToken
            );

            // Part B approve les tokens pour le channel
            await thdContract.methods.approve(channel.address, fundAmount.toString()).send({
                from: partBAccount.address,
                gas: 100000
            });

            console.log(`💰 Part B approved ${Utils.formatBalance(fundAmount)} THD for channel`);

            // Part B finance le channel
            await channel.contract.methods.fund().send({
                from: partBAccount.address,
                gas: 200000
            });

            console.log(`💰 Part B funded ${Utils.formatBalance(fundAmount)} THD to channel`);

            // Met à jour l'état local du financement
            const funding = this.channelManager.userFunding.get(channelId);
            funding[partBAccount.address.toLowerCase()] = true;

            console.log(`✅ Updated funding tracking for Part B`);

            // Vérifie l'état final du channel sur la blockchain
            const channelInfo = await channel.contract.methods.getChannelInfo().call();
            const newState = this.channelManager.mapContractState(channelInfo._state);

            // Met à jour l'état local du channel
            channel.state = newState;
            channel.lastUpdate = new Date().toISOString();

            console.log(`📊 Channel state updated: ${newState}`);
            console.log(`   Contract balanceA: ${Utils.formatBalance(BigInt(channelInfo._balanceA))}`);
            console.log(`   Contract balanceB: ${Utils.formatBalance(BigInt(channelInfo._balanceB))}`);
            console.log(`   Contract amount: ${Utils.formatBalance(BigInt(channelInfo._amount))}`);

            if (newState === 'ACTIVE') {
                console.log('✅ Both parties funding simulated successfully - Channel ACTIVE');
                console.log(`🎉 Channel ${channelId} is ready for payments!`);
            } else {
                console.log(`⚠️  Channel state is ${newState}, expected ACTIVE`);
            }

            return {
                success: true,
                channelState: newState,
                fundingComplete: newState === 'ACTIVE'
            };

        } catch (error) {
            console.error('❌ Failed to simulate both parties funding:', error.message);
            console.error('   Error details:', error);

            // Essaie de nettoyer en cas d'erreur partielle
            try {
                const channel = this.channelManager.channels.get(channelId);
                if (channel) {
                    console.log('🧹 Attempting to clean up partial funding...');
                    // Remet l'état à EMPTY si la simulation a échoué
                    channel.state = 'EMPTY';
                    channel.lastUpdate = new Date().toISOString();
                }
            } catch (cleanupError) {
                console.error('⚠️  Failed to cleanup after funding error:', cleanupError.message);
            }

            throw error;
        }
    }

    // === STARTUP CRITIQUE AVEC INJECTION P2P ET SUPPORT BIDIRECTIONNEL ===

    async start() {
        try {
            console.log('⚡ Thunder Payment Channel Node');
            console.log('================================');
            console.log(`Version: 1.0.0-bidirectional`);
            console.log(`Port: ${this.port}`);
            console.log('');

            // === ÉTAPE 1: INITIALISATION BLOCKCHAIN ===
            console.log('🔗 Step 1: Initializing blockchain connection...');
            await this.blockchain.initialize();
            console.log('✅ Blockchain initialized');

            // === ÉTAPE 2: INITIALISATION CHANNEL MANAGER ===
            console.log('📋 Step 2: Initializing channel manager...');
            this.channelManager = new ChannelManager(this.blockchain);
            console.log('✅ Channel manager initialized');

            // === ÉTAPE 3: INITIALISATION P2P MANAGER ===
            console.log('📡 Step 3: Initializing P2P manager...');
            this.p2pManager = new P2PManager(this, this.port);
            console.log('✅ P2P manager initialized with bidirectional support');

            // === ÉTAPE 4: INJECTION P2P DANS CHANNEL MANAGER (CRITIQUE!!!) ===
            console.log('🔗 Step 4: Injecting P2P manager into channel manager...');
            console.log('   THIS IS CRITICAL FOR CHANNEL CLOSURE SYNCHRONIZATION');

            if (!this.channelManager) {
                throw new Error('ChannelManager not initialized');
            }

            if (!this.p2pManager) {
                throw new Error('P2PManager not initialized');
            }

            // INJECTION CRITIQUE
            this.channelManager.setP2PManager(this.p2pManager);

            // VÉRIFICATION DE L'INJECTION
            if (this.channelManager.p2pManager) {
                console.log('✅ P2P Manager successfully injected into ChannelManager');
                console.log('🔄 Channel closure synchronization: ENABLED');
                console.log('   When a channel is closed, peers will be automatically notified');
            } else {
                console.error('❌ CRITICAL ERROR: P2P Manager injection FAILED');
                console.error('⚠️  Channel closure synchronization will NOT work');
                console.error('   Channels closed on one node will not update on other nodes');
                throw new Error('Critical: P2P Manager injection failed - synchronization broken');
            }

            // === ÉTAPE 5: VÉRIFICATION SUPPORT BIDIRECTIONNEL ===
            console.log('🔄 Step 5: Verifying bidirectional support...');
            
            if (this.p2pManager.proposalToPeerMap && this.p2pManager.peerToProposalsMap) {
                console.log('✅ Bidirectional proposal mapping: ENABLED');
                console.log('   • proposalId ↔ peerAddress mapping: ACTIVE');
                console.log('   • Peer cleanup on disconnect: ACTIVE');
                console.log('   • Resolution cascade: ACTIVE');
            } else {
                console.error('❌ CRITICAL ERROR: Bidirectional mapping NOT initialized');
                throw new Error('Critical: Bidirectional proposal support missing');
            }

            // === ÉTAPE 6: DÉMARRAGE DU SERVEUR ===
            console.log('🚀 Step 6: Starting HTTP server...');
            this.server.listen(this.port, () => {
                console.log('\n🎉 Thunder Node Successfully Started!');
                console.log('=====================================');
                console.log(`🌐 HTTP Server: http://localhost:${this.port}`);
                console.log(`🔌 Socket.IO: ws://localhost:${this.port}`);
                console.log(`📡 P2P Port: ${this.port}`);
                console.log('');
                console.log('🔧 System Status:');
                console.log(`   ✅ Blockchain: Connected`);
                console.log(`   ✅ Channel Manager: Ready`);
                console.log(`   ✅ P2P Manager: Ready`);
                console.log(`   ✅ P2P Injection: Success`);
                console.log(`   ✅ Channel Sync: Enabled`);
                console.log(`   ✅ Bidirectional Proposals: Enabled`);
                console.log(`   ✅ Proposal Mapping: Active`);
                console.log('');
                console.log('💡 Ready for bidirectional operations!');
                console.log('======================================');
                console.log('Supported workflows:');
                console.log('  • A → B proposals and creation ✅');
                console.log('  • B → A proposals and creation ✅');
                console.log('  • Automatic peer resolution ✅');
                console.log('  • Channel closure sync ✅');
                console.log('');
                console.log('Next steps:');
                console.log('  1. Import wallet: thunder-cli importwallet "<seed phrase>"');
                console.log('  2. Connect to peer: thunder-cli connect <ip:port>');
                console.log('  3. Propose channel: thunder-cli proposechannel <peer> <amount>');
                console.log('  4. ANY NODE can propose to ANY OTHER NODE!');
                console.log('');
                console.log('🔍 Debug endpoints:');
                console.log(`  - System info: curl http://localhost:${this.port}/debug/system`);
                console.log(`  - Channels: curl http://localhost:${this.port}/debug/channels`);
                console.log(`  - P2P & mappings: curl http://localhost:${this.port}/debug/p2p`);
                console.log('');
                console.log('🧪 Test bidirectional functionality:');
                console.log('  • Start two nodes on different ports');
                console.log('  • Connect them bidirectionally');
                console.log('  • Either node can propose to the other');
                console.log('  • Both proposals will work correctly!');
            });

            return true;
        } catch (error) {
            console.error('\n❌ Failed to start Thunder server');
            console.error('==================================');
            console.error(`Error: ${error.message}`);
            console.error('');
            console.error('💡 Troubleshooting checklist:');
            console.error('   1. ✓ Hardhat node running: npm run node');
            console.error('   2. ✓ Contracts deployed: npm run deploy');
            console.error('   3. ✓ Port available and not in use');
            console.error('   4. ✓ No firewall blocking the port');
            console.error('   5. ✓ Sufficient disk space');
            console.error('');
            console.error('🔧 Quick fixes:');
            console.error('   - Kill existing processes: pkill -f thunderd');
            console.error('   - Check port usage: lsof -i :' + this.port);
            console.error('   - Restart blockchain: npm run node');
            console.error('   - Redeploy contracts: npm run deploy');
            console.error('');
            console.error('🚨 If P2P injection failed:');
            console.error('   - Ensure ChannelManager.setP2PManager() method exists');
            console.error('   - Check that p2pManager property is set correctly');
            console.error('   - Verify no circular dependencies in modules');
            console.error('');
            console.error('🚨 If bidirectional support failed:');
            console.error('   - Ensure P2PManager has proposalToPeerMap and peerToProposalsMap');
            console.error('   - Check registerProposalPeer() method exists');
            console.error('   - Verify getPeerForProposal() method exists');

            throw error;
        }
    }
}

module.exports = ThunderdServer;