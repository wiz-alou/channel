/**
 * FICHIER: src/thunderd/server.js
 * 
 * DESCRIPTION:
 * Serveur principal Thunder qui expose une API REST pour les payment channels.
 * Intègre le nouveau système de propositions P2P et gère toutes les interactions.
 * 
 * COMPOSANTS:
 * - Express.js server avec API REST
 * - Socket.IO pour communication temps réel
 * - BlockchainManager pour interactions Ethereum
 * - ChannelManager pour gestion des channels
 * - P2PManager pour communication entre nodes
 * 
 * API ENDPOINTS:
 * - GET /infos - Informations du node
 * - POST /importwallet - Importer un wallet
 * - GET /balance - Soldes THD
 * - POST /connect - Se connecter à un peer
 * - POST /proposechannel - Proposer un channel
 * - POST /acceptchannel - Accepter une proposition
 * - POST /createchannel - Créer le smart contract
 * - POST /fundchannel - Financer sa part
 * - POST /pay - Paiement off-chain
 * - POST /closechannel - Fermer un channel
 * - POST /withdraw - Retirer les fonds
 * - GET /proposals - Lister les propositions
 * 
 * WORKFLOW:
 * 1. Start server on specified port
 * 2. Initialize blockchain connection
 * 3. Setup channel and P2P managers
 * 4. Handle API requests from thunder-cli
 * 5. Manage channel lifecycle
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
                version: '1.0.0'
            });
        });
        
        // === INFORMATIONS DU NODE ===
        
        this.app.get('/infos', (req, res) => {
            const channels = this.channelManager ? this.channelManager.getChannels() : [];
            const peers = this.p2pManager ? this.p2pManager.getPeers() : [];
            const proposals = this.channelManager ? this.channelManager.getProposals() : [];
            
            // Sérialise les BigInt pour JSON
            const serializedProposals = proposals.map(proposal => ({
                ...proposal,
                amount: proposal.amount.toString()
            }));
            
            res.json({
                port: this.port,
                connectedPeers: peers,
                channels: channels,
                pendingProposals: serializedProposals,
                blockchain: this.blockchain.getNetworkInfo(),
                wallet: this.wallet ? Utils.formatAddress(this.wallet.address) : null,
                version: '1.0.0',
                uptime: process.uptime()
            });
        });
        
        // === GESTION DU WALLET ===
        
        this.app.post('/importwallet', async (req, res) => {
            try {
                const { seedPhrase, privateKey } = req.body;
                
                if (privateKey) {
                    await this.blockchain.setAccount(privateKey);
                    this.wallet = this.blockchain.currentAccount;
                } else if (seedPhrase) {
                    // Utilise une clé privée prédéfinie pour la démo
                    const testPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
                    await this.blockchain.setAccount(testPrivateKey);
                    this.wallet = this.blockchain.currentAccount;
                } else {
                    throw new Error('No privateKey or seedPhrase provided');
                }
                
                console.log(`🔐 Wallet imported: ${Utils.formatAddress(this.wallet.address)}`);
                
                res.json({
                    success: true,
                    address: this.wallet.address,
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
        
        // 1. Récupère le balance BRUT du wallet (incluant les fonds lockés)
        const walletBalance = await this.blockchain.getBalance();
        
        // 2. Récupère les infos des channels
        const channelBalance = this.getChannelBalance();
        
        console.log(`Balance request for ${Utils.formatAddress(this.wallet.address)}:`);
        console.log(`  Wallet balance: ${walletBalance.formatted} THD`);
        console.log(`  Channel locked: ${Utils.formatBalance(channelBalance.locked)} THD`);
        console.log(`  Channel balance: ${Utils.formatBalance(channelBalance.balance)} THD`);
        
        // ===== MODIFICATION PRINCIPALE =====
        // LOGIQUE AUDIT: Total = balance wallet + locked
        // Available = Total - locked
        
        const totalBalance = walletBalance.balance + channelBalance.locked;
        const availableBalance = totalBalance - channelBalance.locked;
        
        // Alternative si ça ne marche pas:
        // const totalBalance = walletBalance.balance;
        // const availableBalance = walletBalance.balance - channelBalance.locked;
        console.log(`  Total calculated: ${Utils.formatBalance(totalBalance)} THD`);
        console.log(`  Available calculated: ${Utils.formatBalance(availableBalance)} THD`);
        
        res.json({
            success: true,
            address: walletBalance.address,
            totalTHD: Utils.formatBalance(totalBalance),
            availableTHD: Utils.formatBalance(availableBalance),
            channelTHD: Utils.formatBalance(channelBalance.locked),
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
                    peer: `${host}:${port}`
                });
            } catch (error) {
                console.error('Connect error:', error);
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });
        
        // === NOUVEAU WORKFLOW P2P ===
        
        // Proposer un channel
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
                
                // Pour la démo, utilise une adresse prédéfinie pour l'acceptor
                const acceptorAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
                
                const proposal = this.channelManager.createChannelProposal(
                    this.wallet.address,
                    acceptorAddress,
                    amountWei
                );
                
                // Envoie la proposition via P2P
                await this.p2pManager.sendMessage(peerAddress, 'CHANNEL_PROPOSAL', proposal);
                
                res.json({
                    success: true,
                    message: `Channel proposal sent to ${peerAddress}`,
                    proposal: {
                        id: proposal.id,
                        amount: amount,
                        peer: peerAddress,
                        status: proposal.status
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
                        // Trouve le peer qui a envoyé la proposition
                        const originalProposal = this.p2pManager.getProposal(proposalId);
                        if (originalProposal && originalProposal.peer) {
                            await this.p2pManager.sendMessage(originalProposal.peer, 'CHANNEL_ACCEPTED', {
                                proposalId,
                                acceptor: this.wallet.address,
                                timestamp: new Date().toISOString()
                            });
                            console.log(`📤 Notified proposer about acceptance`);
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
        
        // Créer le channel à partir d'une proposition  
        this.app.post('/createchannel', async (req, res) => {
            try {
                if (!this.wallet) {
                    throw new Error('No wallet imported');
                }
                
                const { proposalId } = req.body;
                
                console.log(`🔓 Creating channel from proposal ${proposalId}...`);
                
                const channel = await this.channelManager.createChannelFromProposal(proposalId);
                
                // Debug: Vérifions les propositions disponibles
                console.log(`🔍 Checking P2P proposals for ${proposalId}...`);
                if (this.p2pManager) {
                    const p2pProposal = this.p2pManager.getProposal(proposalId);
                    const channelProposal = this.channelManager.getProposal(proposalId);
                    
                    console.log(`P2P Proposal:`, p2pProposal?.peer ? `Found peer: ${p2pProposal.peer}` : 'Not found');
                    console.log(`Channel Proposal:`, channelProposal ? 'Found' : 'Not found');
                    
                    // Essaie les deux sources de peer
                    let targetPeer = null;
                    if (p2pProposal?.peer) {
                        targetPeer = p2pProposal.peer;
                    } else {
                        // Fallback: utilise le premier peer connecté
                        const connectedPeers = this.p2pManager.getPeers();
                        if (connectedPeers.length > 0) {
                            targetPeer = `${connectedPeers[0].host}:${connectedPeers[0].port}`;
                            console.log(`📡 Using fallback peer: ${targetPeer}`);
                        }
                    }
                    
                    if (targetPeer) {
                        try {
                            await this.p2pManager.sendMessage(targetPeer, 'CHANNEL_CREATED', {
                                proposalId,
                                channelId: channel.id,
                                channelAddress: channel.address,
                                partA: channel.partA,
                                partB: channel.partB,
                                amount: channel.amount.toString(),
                                timestamp: new Date().toISOString()
                            });
                            console.log(`📤 Successfully notified peer ${targetPeer} about channel creation`);
                        } catch (p2pError) {
                            console.error('Failed to notify peer about channel creation:', p2pError.message);
                        }
                    } else {
                        console.error('❌ No peer found to notify about channel creation');
                    }
                } else {
                    console.error('❌ P2P manager not available');
                }
                
                res.json({
                    success: true,
                    message: `Channel created from proposal ${proposalId}`,
                    channel: {
                        id: channel.id,
                        address: channel.address,
                        state: channel.state,
                        needsFunding: true
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
                    proposals: serializedProposals
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
                
                // 🚀 NOUVEAU : Notifie l'autre node du paiement via P2P
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
        
        // === FERMETURE & RETRAIT ===
        
        this.app.post('/closechannel', async (req, res) => {
            try {
                const channels = this.channelManager.getChannels();
                const activeChannel = channels.find(c => c.state === 'ACTIVE');
                
                if (!activeChannel) {
                    throw new Error('No active channel found. Available channels: ' + 
                        channels.map(c => `${c.id}(${c.state})`).join(', '));
                }
                
                const receipt = await this.channelManager.closeChannel(activeChannel.id);
                
                res.json({
                    success: true,
                    message: 'Channel closing initiated',
                    blockNumber: Number(receipt.blockNumber),
                    challengePeriod: 24
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
                
                const receipt = await this.channelManager.withdrawFromChannel(closingChannel.id);
                
                res.json({
                    success: true,
                    message: 'Funds withdrawn successfully',
                    transactionHash: receipt.transactionHash
                });
            } catch (error) {
                console.error('Withdraw error:', error);
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
                
                if (this.p2pManager) {
                    this.p2pManager.handleMessage(message, fromPeer);
                }
                
                res.json({ success: true, received: true });
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
                error: 'Internal server error'
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
            
            await thdContract.methods.approve(channel.address, fundAmount.toString()).send({
                from: partBAccount.address,
                gas: 100000
            });
            
            await channel.contract.methods.fund().send({
                from: partBAccount.address,
                gas: 200000
            });
            
            // Met à jour l'état
            const funding = this.channelManager.userFunding.get(channelId);
            funding[partBAccount.address.toLowerCase()] = true;
            
            // Vérifie l'état final du channel
            const channelInfo = await channel.contract.methods.getChannelInfo().call();
            channel.state = this.channelManager.mapContractState(channelInfo._state);
            
            console.log('✅ Both parties funding simulated - Channel ACTIVE');
            
        } catch (error) {
            console.error('❌ Failed to simulate both parties funding:', error.message);
            throw error;
        }
    }
    
    // === STARTUP ===
    
    async start() {
        try {
            console.log('⚡ Thunder Payment Channel Node');
            console.log('================================');
            console.log(`Version: 1.0.0`);
            console.log(`Port: ${this.port}`);
            console.log('');
            
            // Initialise la blockchain
            await this.blockchain.initialize();
            
            // Initialise le gestionnaire de channels
            this.channelManager = new ChannelManager(this.blockchain);
            
            // Initialise le gestionnaire P2P
            this.p2pManager = new P2PManager(this, this.port);
            
            // Démarre le serveur
            this.server.listen(this.port, () => {
                console.log(`🚀 Thunderd server running on port ${this.port}`);
                console.log(`   API: http://localhost:${this.port}`);
                console.log(`   Socket.IO: ws://localhost:${this.port}`);
                console.log('');
                console.log('💡 Ready for connections!');
                console.log(`   Import wallet: thunder-cli importwallet "<seed phrase>"`);
                console.log(`   Connect peer: thunder-cli connect <ip:port>`);
                console.log(`   Propose channel: thunder-cli proposechannel <peer> <amount>`);
            });
            
            return true;
        } catch (error) {
            console.error('❌ Failed to start Thunder server:', error.message);
            console.error('');
            console.error('💡 Troubleshooting:');
            console.error('   1. Make sure Hardhat node is running: npm run node');
            console.error('   2. Deploy contracts: npm run deploy');
            console.error('   3. Check port availability');
            throw error;
        }
    }
}

module.exports = ThunderdServer;