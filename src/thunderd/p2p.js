/**
 * FICHIER: src/thunderd/p2p.js
 * 
 * DESCRIPTION:
 * Gestionnaire de communication peer-to-peer entre nodes Thunder.
 * VERSION CORRIGÉE avec synchronisation robuste des fermetures de canaux.
 * 
 * FONCTIONNALITÉS:
 * - Connexion bidirectionnelle entre nodes
 * - Envoi/réception de messages typés
 * - Gestion des propositions de channels
 * - Propagation des paiements off-chain
 * - Synchronisation des états de channels
 * - CORRIGÉ: Synchronisation automatique et robuste de fermeture de channels
 * 
 * CORRECTIONS APPORTÉES:
 * 1. Handler CHANNEL_CLOSED amélioré avec validation stricte
 * 2. Synchronisation d'état robuste entre nodes
 * 3. Vérification d'éligibilité automatique pour withdraw
 * 4. Gestion d'erreurs améliorée
 * 5. Logging détaillé pour debug
 */

const axios = require('axios');
const Utils = require('../shared/utils');

class P2PManager {
    constructor(server, port) {
        this.server = server;                     // Référence au serveur Thunder
        this.port = port;                         // Port de ce node
        this.peers = new Map();                   // Peers connectés
        this.pendingChannelProposals = new Map(); // Propositions en attente
        this.messageHandlers = new Map();         // Handlers pour chaque type de message
        this.messageHistory = new Map();          // Historique des messages (évite doublons)
        
        this.setupMessageHandlers();
        console.log(`📡 P2P Manager initialized on port ${this.port} with enhanced channel sync`);
    }
    
    // === SETUP DES HANDLERS ===
    
    /**
     * Configure les handlers pour chaque type de message P2P
     */
    setupMessageHandlers() {
        // Connexion d'un peer
        this.messageHandlers.set('PEER_CONNECTED', (data, fromPeer) => {
            this.handlePeerConnected(data, fromPeer);
        });
        
        // Proposition de channel
        this.messageHandlers.set('CHANNEL_PROPOSAL', (data, fromPeer) => {
            this.handleChannelProposal(data, fromPeer);
        });
        
        // Acceptation de proposition
        this.messageHandlers.set('CHANNEL_ACCEPTED', (data, fromPeer) => {
            this.handleChannelAccepted(data, fromPeer);
        });
        
        // Channel créé
        this.messageHandlers.set('CHANNEL_CREATED', (data, fromPeer) => {
            this.handleChannelCreated(data, fromPeer);
        });
        
        // Channel financé
        this.messageHandlers.set('CHANNEL_FUNDED', (data, fromPeer) => {
            this.handleChannelFunded(data, fromPeer);
        });
        
        // Paiement off-chain
        this.messageHandlers.set('PAYMENT', (data, fromPeer) => {
            this.handlePayment(data, fromPeer);
        });
        
        // Fermeture de channel (ancienne version - gardée pour compatibilité)
        this.messageHandlers.set('CHANNEL_CLOSING', (data, fromPeer) => {
            this.handleChannelClosing(data, fromPeer);
        });
        
        // CORRIGÉ: Handler amélioré pour fermeture confirmée
        this.messageHandlers.set('CHANNEL_CLOSED', (data, fromPeer) => {
            this.handleChannelClosed(data, fromPeer);
        });
        
        console.log(`✅ Message handlers configured: ${this.messageHandlers.size} types`);
        console.log(`   Supported messages: ${Array.from(this.messageHandlers.keys()).join(', ')}`);
    }
    
    // === GESTION DES CONNEXIONS ===
    
    /**
     * Se connecte à un peer distant
     * @param {string} host - Adresse IP ou hostname
     * @param {number} port - Port du peer
     */
    async connectToPeer(host, port) {
        try {
            const peerUrl = `http://${host}:${port}`;
            const peerAddress = `${host}:${port}`;
            
            // Test de connexion
            console.log(`🔍 Testing connection to ${peerAddress}...`);
            const response = await axios.get(`${peerUrl}/health`, { timeout: 5000 });
            
            if (response.status === 200) {
                // Stocke les informations du peer
                this.peers.set(peerAddress, {
                    host,
                    port,
                    url: peerUrl,
                    connected: true,
                    connectedAt: new Date().toISOString(),
                    lastSeen: new Date().toISOString()
                });
                
                // Notifie le peer de notre existence
                await this.sendMessage(peerAddress, 'PEER_CONNECTED', {
                    fromHost: 'localhost',
                    fromPort: this.port,
                    nodeInfo: {
                        version: '1.0.0',
                        capabilities: ['channels', 'payments', 'p2p', 'channel-sync']
                    },
                    timestamp: new Date().toISOString()
                });
                
                console.log(`🔗 Successfully connected to peer: ${peerAddress}`);
                console.log(`   Peer URL: ${peerUrl}`);
                console.log(`   Connection established at: ${new Date().toLocaleString()}`);
                
                return true;
            }
        } catch (error) {
            console.error(`❌ Failed to connect to ${host}:${port}:`);
            console.error(`   Error: ${error.message}`);
            
            if (error.code === 'ECONNREFUSED') {
                console.error(`   💡 Make sure thunderd is running on ${host}:${port}`);
            } else if (error.code === 'ETIMEDOUT') {
                console.error(`   💡 Connection timeout - check network connectivity`);
            }
            
            throw new Error(`Cannot connect to peer ${host}:${port}: ${error.message}`);
        }
    }
    
    /**
     * Déconnecte d'un peer
     * @param {string} peerAddress - Adresse du peer (host:port)
     */
    async disconnectFromPeer(peerAddress) {
        try {
            if (this.peers.has(peerAddress)) {
                // Notifie le peer de la déconnexion
                await this.sendMessage(peerAddress, 'PEER_DISCONNECTED', {
                    fromPort: this.port,
                    reason: 'Manual disconnect',
                    timestamp: new Date().toISOString()
                });
                
                this.peers.delete(peerAddress);
                console.log(`🔌 Disconnected from peer: ${peerAddress}`);
                return true;
            } else {
                throw new Error('Peer not found');
            }
        } catch (error) {
            console.error(`❌ Failed to disconnect from ${peerAddress}:`, error.message);
            // Force removal même en cas d'erreur
            this.peers.delete(peerAddress);
        }
    }
    
    // === ENVOI DE MESSAGES ===
    
    /**
     * Envoie un message à un peer spécifique
     * @param {string} peerAddress - Adresse du peer
     * @param {string} type - Type de message
     * @param {Object} data - Données du message
     */
    async sendMessage(peerAddress, type, data) {
        try {
            const peer = this.peers.get(peerAddress);
            if (!peer) {
                throw new Error(`Peer ${peerAddress} not connected`);
            }
            
            // Convert BigInt to string for JSON serialization
            const serializableData = this.serializeBigInt(data);
            
            const message = {
                type,
                data: serializableData,
                from: `localhost:${this.port}`,
                to: peerAddress,
                timestamp: new Date().toISOString(),
                messageId: Utils.generateId()
            };
            
            console.log(`📤 Sending ${type} to ${peerAddress}`);
            console.log(`   Message ID: ${message.messageId}`);
            
            const response = await axios.post(`${peer.url}/p2p/message`, message, {
                timeout: 10000,
                headers: { 'Content-Type': 'application/json' }
            });
            
            // Met à jour la dernière fois qu'on a vu le peer
            peer.lastSeen = new Date().toISOString();
            
            console.log(`✅ Message ${type} sent successfully to ${peerAddress}`);
            return response.data;
            
        } catch (error) {
            console.error(`❌ Failed to send message to ${peerAddress}:`);
            console.error(`   Type: ${type}`);
            console.error(`   Error: ${error.message}`);
            
            // Marque le peer comme potentiellement déconnecté
            const peer = this.peers.get(peerAddress);
            if (peer && (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT')) {
                peer.connected = false;
                console.error(`   ⚠️  Peer ${peerAddress} appears to be offline`);
            }
            
            throw error;
        }
    }
    
    /**
     * Convertit les BigInt en strings pour la sérialisation JSON
     */
    serializeBigInt(obj) {
        if (obj === null || obj === undefined) return obj;
        
        if (typeof obj === 'bigint') {
            return obj.toString();
        }
        
        if (Array.isArray(obj)) {
            return obj.map(item => this.serializeBigInt(item));
        }
        
        if (typeof obj === 'object') {
            const result = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.serializeBigInt(value);
            }
            return result;
        }
        
        return obj;
    }
    
    /**
     * Convertit les strings en BigInt après désérialisation
     */
    deserializeBigInt(obj, bigIntFields = ['amount', 'balance', 'balanceA', 'balanceB', 'finalBalanceA', 'finalBalanceB']) {
        if (obj === null || obj === undefined) return obj;
        
        if (Array.isArray(obj)) {
            return obj.map(item => this.deserializeBigInt(item, bigIntFields));
        }
        
        if (typeof obj === 'object') {
            const result = { ...obj };
            for (const field of bigIntFields) {
                if (result[field] && typeof result[field] === 'string') {
                    try {
                        result[field] = BigInt(result[field]);
                    } catch (error) {
                        // Keep as string if conversion fails
                    }
                }
            }
            return result;
        }
        
        return obj;
    }
    
    /**
     * Diffuse un message à tous les peers connectés
     * @param {string} type - Type de message
     * @param {Object} data - Données du message
     */
    async broadcastMessage(type, data) {
        const results = [];
        const activePeers = Array.from(this.peers.entries()).filter(([_, peer]) => peer.connected);
        
        console.log(`📡 Broadcasting ${type} to ${activePeers.length} peers`);
        
        if (activePeers.length === 0) {
            console.log(`ℹ️  No active peers for broadcast`);
            return [];
        }
        
        for (const [peerAddress, peer] of activePeers) {
            try {
                const result = await this.sendMessage(peerAddress, type, data);
                results.push({ peer: peerAddress, success: true, result });
                console.log(`✅ Broadcast to ${peerAddress}: SUCCESS`);
            } catch (error) {
                results.push({ peer: peerAddress, success: false, error: error.message });
                console.log(`❌ Broadcast to ${peerAddress}: FAILED - ${error.message}`);
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        console.log(`📡 Broadcast ${type} complete: ${successCount}/${activePeers.length} successful`);
        
        return results;
    }
    
    // === RÉCEPTION DE MESSAGES ===
    
    /**
     * Traite un message reçu d'un peer
     * @param {Object} message - Message reçu
     * @param {string} fromPeer - Adresse du peer expéditeur
     */
    handleMessage(message, fromPeer) {
        const { type, data, messageId, timestamp } = message;
        
        // Évite le traitement en double
        if (this.messageHistory.has(messageId)) {
            console.log(`🔄 Ignoring duplicate message ${messageId} from ${fromPeer}`);
            return;
        }
        
        this.messageHistory.set(messageId, { timestamp, fromPeer, type });
        
        // Nettoye l'historique (garde seulement les 1000 derniers messages)
        if (this.messageHistory.size > 1000) {
            const oldestKey = this.messageHistory.keys().next().value;
            this.messageHistory.delete(oldestKey);
        }
        
        console.log(`📥 Received ${type} from ${fromPeer}`);
        console.log(`   Message ID: ${messageId}`);
        console.log(`   Timestamp: ${new Date(timestamp).toLocaleString()}`);
        
        // Trouve et exécute le handler approprié
        const handler = this.messageHandlers.get(type);
        if (handler) {
            try {
                handler(data, fromPeer);
            } catch (error) {
                console.error(`❌ Error handling ${type} from ${fromPeer}:`, error.message);
                console.error(`   Error details:`, error);
            }
        } else {
            console.log(`⚠️  No handler for message type: ${type}`);
            console.log(`   Available handlers: ${Array.from(this.messageHandlers.keys()).join(', ')}`);
        }
    }
    
    // === HANDLERS DE MESSAGES ===
    
    /**
     * Gère la notification de connexion d'un peer
     */
    handlePeerConnected(data, fromPeer) {
        const { fromHost, fromPort, nodeInfo } = data;
        
        console.log(`👋 Peer connected: ${fromPeer}`);
        console.log(`   Node info: version ${nodeInfo?.version || 'unknown'}`);
        console.log(`   Capabilities: ${nodeInfo?.capabilities?.join(', ') || 'none'}`);
        
        // Met à jour ou ajoute le peer
        const peerAddress = `${fromHost}:${fromPort}`;
        if (!this.peers.has(peerAddress)) {
            this.peers.set(peerAddress, {
                host: fromHost,
                port: fromPort,
                url: `http://${fromHost}:${fromPort}`,
                connected: true,
                connectedAt: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                nodeInfo: nodeInfo
            });
        }
    }
    
    /**
     * Gère une proposition de channel reçue
     */
    handleChannelProposal(data, fromPeer) {
        // Convertit les strings en BigInt si nécessaire
        const proposalData = this.deserializeBigInt(data, ['amount']);
        const { id, proposer, acceptor, amount } = proposalData;
        
        console.log(`📋 Received channel proposal from ${fromPeer}`);
        console.log(`   Proposal ID: ${id}`);
        console.log(`   Proposer: ${Utils.formatAddress(proposer)}`);
        console.log(`   Acceptor: ${Utils.formatAddress(acceptor)}`);
        console.log(`   Amount: ${Utils.formatBalance(BigInt(amount))} THD`);
        
        // Stocke la proposition pour traitement manuel
        this.pendingChannelProposals.set(id, {
            ...proposalData,
            status: 'RECEIVED',
            peer: fromPeer,
            receivedAt: new Date().toISOString()
        });
        
        // Ajoute la proposition au gestionnaire de channels si possible
        if (this.server.channelManager) {
            try {
                this.server.channelManager.proposals.set(id, {
                    ...proposalData,
                    status: 'PROPOSED'
                });
                console.log(`📋 Proposal stored in channel manager`);
            } catch (error) {
                console.error(`❌ Failed to store proposal in channel manager:`, error.message);
            }
        }
        
        console.log(`💡 To accept: thunder-cli acceptchannel ${id}`);
    }
    
    /**
     * Gère l'acceptation d'une proposition
     */
    handleChannelAccepted(data, fromPeer) {
        const { proposalId, acceptor } = data;
        
        console.log(`✅ Channel proposal ${proposalId} accepted by ${Utils.formatAddress(acceptor)}`);
        console.log(`   Acceptor: ${Utils.formatAddress(acceptor)}`);
        console.log(`   From peer: ${fromPeer}`);
        
        // Met à jour la proposition locale
        const proposal = this.pendingChannelProposals.get(proposalId);
        if (proposal) {
            proposal.status = 'ACCEPTED';
            proposal.acceptor = acceptor;
            proposal.acceptedAt = new Date().toISOString();
        }
        
        // Met à jour aussi dans le channel manager
        if (this.server.channelManager) {
            const channelProposal = this.server.channelManager.proposals.get(proposalId);
            if (channelProposal) {
                channelProposal.status = 'ACCEPTED';
                channelProposal.acceptor = acceptor;
                channelProposal.acceptedAt = new Date().toISOString();
                
                console.log(`📋 Updated proposal status in channel manager: ACCEPTED`);
            }
        }
        
        console.log(`🚀 Ready to create channel! Use: thunder-cli createchannel ${proposalId}`);
    }
    
    /**
     * Gère la création d'un channel
     */
    handleChannelCreated(data, fromPeer) {
        const { proposalId, channelId, channelAddress, partA, partB, amount } = data;
        
        console.log(`🔓 Channel created from proposal ${proposalId}`);
        console.log(`   Channel ID: ${channelId}`);
        console.log(`   Channel Address: ${Utils.formatAddress(channelAddress)}`);
        console.log(`   Part A: ${Utils.formatAddress(partA)}`);
        console.log(`   Part B: ${Utils.formatAddress(partB)}`);
        console.log(`   Amount: ${Utils.formatBalance(BigInt(amount))} THD`);
        console.log(`   From peer: ${fromPeer}`);
        
        // Met à jour la proposition locale
        const proposal = this.pendingChannelProposals.get(proposalId);
        if (proposal) {
            proposal.status = 'CREATED';
            proposal.channelId = channelId;
            proposal.channelAddress = channelAddress;
        }
        
        // Crée le channel dans le gestionnaire local avec contract setup
        if (this.server.channelManager && this.server.blockchain) {
            try {
                console.log(`📋 Setting up channel contract locally...`);
                
                // Setup du contract
                const channelAbi = require('../../artifacts/contracts/PaymentChannel.sol/PaymentChannel.json').abi;
                const channelContract = new this.server.blockchain.web3.eth.Contract(channelAbi, channelAddress);
                
                // Crée le channel data complet
                const channelData = {
                    id: channelId,
                    address: channelAddress,
                    contract: channelContract,
                    partA,
                    partB,
                    amount: BigInt(amount),
                    state: 'EMPTY',
                    nonce: 0,
                    balanceA: BigInt(amount) / BigInt(2),
                    balanceB: BigInt(amount) / BigInt(2),
                    createdAt: new Date().toISOString(),
                    pendingPayments: [],
                    proposalId: proposalId,
                    lastUpdate: new Date().toISOString()
                };
                
                this.server.channelManager.channels.set(channelId, channelData);
                
                // Initialise le suivi du financement
                this.server.channelManager.userFunding.set(channelId, {
                    [partA.toLowerCase()]: false,
                    [partB.toLowerCase()]: false
                });
                
                // Met à jour la proposition dans le channel manager aussi
                if (this.server.channelManager.proposals.has(proposalId)) {
                    const channelProposal = this.server.channelManager.proposals.get(proposalId);
                    channelProposal.status = 'CREATED';
                    channelProposal.channelId = channelId;
                }
                
                console.log(`✅ Channel synchronized locally with contract setup`);
                console.log(`   Contract address: ${channelAddress}`);
                console.log(`   Funding tracking initialized`);
                
            } catch (error) {
                console.error('❌ Failed to synchronize channel locally:', error.message);
                console.error('Error details:', error);
            }
        }
        
        console.log(`💰 Ready to fund! Use: thunder-cli fundchannel ${channelId}`);
    }
    
    /**
     * Gère la notification de financement
     */
    handleChannelFunded(data, fromPeer) {
        const { channelId, userAddress, bothFunded, channelState } = data;
        
        console.log(`💰 Channel ${channelId} funded by ${Utils.formatAddress(userAddress)}`);
        console.log(`   From peer: ${fromPeer}`);
        console.log(`   Both funded: ${bothFunded ? 'Yes' : 'No'}`);
        console.log(`   Channel state: ${channelState}`);
        
        // Met à jour l'état local du channel
        if (this.server.channelManager) {
            const channel = this.server.channelManager.channels.get(channelId);
            if (channel) {
                // Met à jour le funding tracking
                const funding = this.server.channelManager.userFunding.get(channelId);
                if (funding) {
                    funding[userAddress.toLowerCase()] = true;
                    console.log(`✅ Updated funding status for ${Utils.formatAddress(userAddress)}`);
                }
                
                // Met à jour l'état du channel si les deux ont financé
                if (bothFunded && channelState === 'ACTIVE') {
                    channel.state = 'ACTIVE';
                    channel.lastUpdate = new Date().toISOString();
                    console.log(`🎉 Channel ${channelId} is now ACTIVE locally!`);
                }
            } else {
                console.log(`⚠️  Channel ${channelId} not found locally for funding update`);
            }
        }
        
        if (bothFunded) {
            console.log(`🎉 Channel is now ACTIVE and ready for payments!`);
        }
    }
    
    /**
     * Gère un paiement off-chain reçu
     */
    handlePayment(data, fromPeer) {
        const { channelId, paymentId, amount, nonce, balanceA, balanceB, signature, from, to } = data;
        
        console.log(`💸 Received payment from ${fromPeer}`);
        console.log(`   Channel: ${channelId}`);
        console.log(`   Amount: ${Utils.formatBalance(BigInt(amount))} THD`);
        console.log(`   Nonce: ${nonce}`);
        console.log(`   From: ${Utils.formatAddress(from)}`);
        console.log(`   To: ${Utils.formatAddress(to)}`);
        
        // Applique le paiement localement
        if (this.server.channelManager) {
            try {
                const channel = this.server.channelManager.channels.get(channelId);
                if (channel) {
                    console.log(`🔄 Applying payment to local channel state...`);
                    console.log(`   Current balances: A=${Utils.formatBalance(channel.balanceA)}, B=${Utils.formatBalance(channel.balanceB)}`);
                    console.log(`   New balances: A=${Utils.formatBalance(BigInt(balanceA))}, B=${Utils.formatBalance(BigInt(balanceB))}`);
                    
                    // Vérifie que le nonce est plus récent
                    if (nonce > channel.nonce) {
                        // Met à jour l'état du channel
                        channel.nonce = nonce;
                        channel.balanceA = BigInt(balanceA);
                        channel.balanceB = BigInt(balanceB);
                        channel.lastUpdate = new Date().toISOString();
                        
                        // Ajoute le paiement à l'historique
                        const paymentRecord = {
                            id: paymentId,
                            nonce: nonce,
                            balanceA: BigInt(balanceA),
                            balanceB: BigInt(balanceB),
                            amount: BigInt(amount),
                            from: from,
                            to: to,
                            signature: signature,
                            timestamp: data.timestamp,
                            receivedViaP2P: true
                        };
                        
                        channel.pendingPayments.push(paymentRecord);
                        
                        console.log(`✅ Payment applied successfully`);
                        console.log(`   Updated balances: A=${Utils.formatBalance(channel.balanceA)}, B=${Utils.formatBalance(channel.balanceB)}`);
                        console.log(`   Channel nonce: ${channel.nonce}`);
                        
                        // Détermine qui reçoit le paiement
                        const currentUserAddress = this.server.wallet?.address;
                        if (currentUserAddress) {
                            const isCurrentUserRecipient = to.toLowerCase() === currentUserAddress.toLowerCase();
                            if (isCurrentUserRecipient) {
                                console.log(`🎉 You received ${Utils.formatBalance(BigInt(amount))} THD!`);
                            }
                        }
                        
                    } else {
                        console.log(`⚠️  Payment nonce ${nonce} is not newer than current ${channel.nonce}, ignoring`);
                    }
                } else {
                    console.error(`❌ Channel ${channelId} not found locally for payment`);
                }
            } catch (error) {
                console.error(`❌ Failed to apply payment locally:`, error.message);
            }
        }
    }
    
    /**
     * Gère la notification de fermeture de channel (ancienne version)
     */
    handleChannelClosing(data, fromPeer) {
        const { channelId, nonce, balanceA, balanceB, signature } = data;
        
        console.log(`🔒 Peer ${fromPeer} is closing channel ${channelId}`);
        console.log(`   Final state: nonce=${nonce}`);
        console.log(`   Balances: A=${Utils.formatBalance(BigInt(balanceA))}, B=${Utils.formatBalance(BigInt(balanceB))}`);
        
        // TODO: Valider l'état de fermeture et potentiellement challenger
        console.log(`⚠️  Channel closing validation not implemented in this version`);
    }
    
    /**
     * CORRIGÉ: Gère la notification de fermeture confirmée avec synchronisation robuste
     */
// CORRECTION DANS src/thunderd/p2p.js
// Méthode handleChannelClosed - ligne ~400 environ

/**
 * CORRIGÉ: Gère la notification de fermeture confirmée avec synchronisation robuste des BALANCES
 */
handleChannelClosed(data, fromPeer) {
    console.log(`\n🔒 ===== CHANNEL CLOSURE NOTIFICATION RECEIVED =====`);
    console.log(`   From peer: ${fromPeer}`);
    console.log(`   Timestamp: ${new Date().toLocaleString()}`);
    
    const { 
        channelId, 
        channelAddress, 
        closingBlock, 
        finalBalanceA, 
        finalBalanceB, 
        nonce, 
        closedBy, 
        partA, 
        partB,
        transactionHash,
        challengePeriod = 24
    } = data;
    
    console.log(`📋 Channel closure details:`);
    console.log(`   Channel ID: ${channelId}`);
    console.log(`   Channel Address: ${Utils.formatAddress(channelAddress)}`);
    console.log(`   Closed by: ${Utils.formatAddress(closedBy)}`);
    console.log(`   Participants: A=${Utils.formatAddress(partA)}, B=${Utils.formatAddress(partB)}`);
    console.log(`   Closing block: ${closingBlock}`);
    console.log(`   Final balances: A=${Utils.formatBalance(BigInt(finalBalanceA))}, B=${Utils.formatBalance(BigInt(finalBalanceB))}`);
    console.log(`   Nonce: ${nonce}`);
    console.log(`   Transaction: ${transactionHash || 'N/A'}`);
    console.log(`   Challenge period: ${challengePeriod} blocks`);
    
    // === VALIDATION ET SYNCHRONISATION ===
    
    if (!this.server.channelManager) {
        console.log(`❌ Channel manager not available for synchronization`);
        return;
    }
    
    const channel = this.server.channelManager.channels.get(channelId);
    if (!channel) {
        console.log(`⚠️  Channel ${channelId} not found locally`);
        console.log(`   This might be expected if you weren't a participant`);
        return;
    }
    
    // Vérifie que l'utilisateur actuel est participant
    const currentUserAddress = this.server.wallet?.address?.toLowerCase();
    if (!currentUserAddress) {
        console.log(`⚠️  No wallet loaded for validation`);
        return;
    }
    
    const isParticipant = currentUserAddress === partA.toLowerCase() || 
                        currentUserAddress === partB.toLowerCase();
    
    if (!isParticipant) {
        console.log(`ℹ️  Channel closure not relevant (current user not a participant)`);
        console.log(`   Current user: ${Utils.formatAddress(currentUserAddress)}`);
        return;
    }
    
    console.log(`✅ Validation passed - user is participant`);
    console.log(`   Current user: ${Utils.formatAddress(currentUserAddress)}`);
    console.log(`   Participant role: ${currentUserAddress === partA.toLowerCase() ? 'Part A' : 'Part B'}`);
    
    // === SYNCHRONISATION D'ÉTAT LOCAL AVEC BALANCES ===
    
    console.log(`🔄 Synchronizing local channel state...`);
    console.log(`   Current state: ${channel.state}`);
    console.log(`   Current nonce: ${channel.nonce}`);
    console.log(`   Current balances: A=${Utils.formatBalance(channel.balanceA)}, B=${Utils.formatBalance(channel.balanceB)}`);
    
    try {
        // Met à jour l'état local du channel
        const previousState = channel.state;
        const previousBalanceA = channel.balanceA;
        const previousBalanceB = channel.balanceB;
        
        // === CORRECTION CRITIQUE: Synchronisation des balances ===
        channel.state = 'CLOSING';
        channel.closingBlock = closingBlock;
        channel.balanceA = BigInt(finalBalanceA);  // ← CORRECTION ICI
        channel.balanceB = BigInt(finalBalanceB);  // ← CORRECTION ICI
        channel.nonce = nonce;
        channel.lastUpdate = new Date().toISOString();
        
        console.log(`✅ Local channel state synchronized successfully`);
        console.log(`   State: ${previousState} → CLOSING`);
        console.log(`   Nonce: ${channel.nonce}`);
        console.log(`   Balance A: ${Utils.formatBalance(previousBalanceA)} → ${Utils.formatBalance(channel.balanceA)}`);
        console.log(`   Balance B: ${Utils.formatBalance(previousBalanceB)} → ${Utils.formatBalance(channel.balanceB)}`);
        console.log(`   Closing block: ${channel.closingBlock}`);
        
        // === AFFICHAGE POUR L'UTILISATEUR ACTUEL ===
        const isCurrentUserPartA = currentUserAddress === partA.toLowerCase();
        const userFinalBalance = isCurrentUserPartA ? channel.balanceA : channel.balanceB;
        const userRole = isCurrentUserPartA ? 'Part A' : 'Part B';
        
        console.log(`\n💰 Your final balance summary:`);
        console.log(`   Your role: ${userRole}`);
        console.log(`   Your final balance: ${Utils.formatBalance(userFinalBalance)} THD`);
        console.log(`   Partner's balance: ${Utils.formatBalance(isCurrentUserPartA ? channel.balanceB : channel.balanceA)} THD`);
        console.log(`   Total channel: ${Utils.formatBalance(channel.balanceA + channel.balanceB)} THD`);
        
        // === VÉRIFICATION AUTOMATIQUE D'ÉLIGIBILITÉ ===
        this.checkWithdrawEligibility(channel, challengePeriod);
        
    } catch (syncError) {
        console.error(`❌ Failed to synchronize channel state:`, syncError.message);
        console.error(`   Channel closure notification received but local sync failed`);
    }
    
    console.log(`\n💡 Channel closure summary for user:`);
    console.log(`   ✅ Blockchain closure: CONFIRMED by peer`);
    console.log(`   🔄 Local sync: ${channel.state === 'CLOSING' ? 'SUCCESS' : 'FAILED'}`);
    console.log(`   💰 Balance sync: ${channel.balanceA && channel.balanceB ? 'SUCCESS' : 'FAILED'}`);
    console.log(`   🎯 Next action: Wait for challenge period, then withdraw`);
    console.log(`   📋 Commands:`);
    console.log(`      - Check status: thunder-cli infos`);
    console.log(`      - Check balance: thunder-cli balance`);
    console.log(`      - Mine blocks: npm run mine-blocks 25`);
    console.log(`      - Withdraw: thunder-cli withdraw`);
    
    console.log(`===== CHANNEL CLOSURE NOTIFICATION PROCESSED =====\n`);
}
    
    /**
     * NOUVEAU: Vérification automatique d'éligibilité au withdraw
     */
    async checkWithdrawEligibility(channel, challengePeriod = 24) {
        try {
            console.log(`\n🔍 Checking withdraw eligibility...`);
            
            if (!this.server.blockchain) {
                console.log(`⚠️  Blockchain not available for eligibility check`);
                return;
            }
            
            const currentBlock = await this.server.blockchain.web3.eth.getBlockNumber();
            const currentBlockNum = Number(currentBlock);
            const closingBlockNum = Number(channel.closingBlock);
            const blocksRemaining = (closingBlockNum + challengePeriod) - currentBlockNum;
            
            console.log(`📊 Withdraw eligibility status:`);
            console.log(`   Current block: ${currentBlockNum}`);
            console.log(`   Closing block: ${closingBlockNum}`);
            console.log(`   Challenge period: ${challengePeriod} blocks`);
            console.log(`   Required block: ${closingBlockNum + challengePeriod}`);
            console.log(`   Blocks remaining: ${blocksRemaining}`);
            
            if (blocksRemaining <= 0) {
                console.log(`\n🎉 WITHDRAW AVAILABLE NOW!`);
                console.log(`================================`);
                console.log(`Challenge period has expired.`);
                console.log(`You can withdraw your funds immediately.`);
                console.log(`\n💎 Use: thunder-cli withdraw`);
                
                // Optionnel: Calculer le montant que l'utilisateur va recevoir
                const currentUserAddress = this.server.wallet?.address?.toLowerCase();
                const isPartA = currentUserAddress === channel.partA.toLowerCase();
                const userFinalBalance = isPartA ? channel.balanceA : channel.balanceB;
                
                console.log(`\n💰 Your final balance: ${Utils.formatBalance(userFinalBalance)} THD`);
                
            } else {
                console.log(`\n⏳ Challenge period active`);
                console.log(`============================`);
                console.log(`${blocksRemaining} blocks remaining until withdrawal.`);
                console.log(`\n🔨 Speed up with: npm run mine-blocks ${blocksRemaining + 1}`);
                console.log(`📅 Or wait naturally for ${blocksRemaining} blocks`);
                console.log(`💎 Then use: thunder-cli withdraw`);
            }
            
        } catch (error) {
            console.error(`❌ Failed to check withdraw eligibility:`, error.message);
            console.log(`💡 You can still try: thunder-cli withdraw`);
            console.log(`   The command will tell you if challenge period is expired`);
        }
    }
    
    // === UTILITAIRES ===
    
    /**
     * Retourne la liste des peers connectés
     */
    getPeers() {
        return Array.from(this.peers.values()).map(peer => ({
            host: peer.host,
            port: peer.port,
            connected: peer.connected,
            connectedAt: peer.connectedAt,
            lastSeen: peer.lastSeen,
            nodeInfo: peer.nodeInfo
        }));
    }
    
    /**
     * Retourne les propositions en attente
     */
    getPendingProposals() {
        return Array.from(this.pendingChannelProposals.values());
    }
    
    /**
     * Retourne une proposition spécifique
     */
    getProposal(proposalId) {
        return this.pendingChannelProposals.get(proposalId);
    }
    
    /**
     * Vérifie l'état des connexions peers
     */
    async checkPeerConnections() {
        console.log(`🔍 Checking ${this.peers.size} peer connections...`);
        
        for (const [peerAddress, peer] of this.peers.entries()) {
            try {
                const response = await axios.get(`${peer.url}/health`, { timeout: 3000 });
                
                if (response.status === 200) {
                    peer.connected = true;
                    peer.lastSeen = new Date().toISOString();
                } else {
                    peer.connected = false;
                }
            } catch (error) {
                peer.connected = false;
                console.log(`⚠️  Peer ${peerAddress} appears offline`);
            }
        }
        
        const activePeers = Array.from(this.peers.values()).filter(p => p.connected).length;
        console.log(`📊 Connection check complete: ${activePeers}/${this.peers.size} peers active`);
    }
    
    /**
     * Nettoie les anciennes données et connexions
     */
    cleanup() {
        // Supprime les peers déconnectés depuis plus d'1 heure
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        
        for (const [peerAddress, peer] of this.peers.entries()) {
            const lastSeenTime = new Date(peer.lastSeen).getTime();
            
            if (!peer.connected && lastSeenTime < oneHourAgo) {
                console.log(`🧹 Cleaning up old peer: ${peerAddress}`);
                this.peers.delete(peerAddress);
            }
        }
        
        // Nettoie les propositions anciennes (plus de 24h)
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        
        for (const [proposalId, proposal] of this.pendingChannelProposals.entries()) {
            const createdTime = new Date(proposal.receivedAt || proposal.createdAt).getTime();
            
            if (createdTime < oneDayAgo && (proposal.status === 'RECEIVED' || proposal.status === 'PROPOSED')) {
                console.log(`🧹 Cleaning up old proposal: ${proposalId}`);
                this.pendingChannelProposals.delete(proposalId);
            }
        }
    }
    
    /**
     * Retourne des statistiques P2P
     */
    getStats() {
        const activePeers = Array.from(this.peers.values()).filter(p => p.connected).length;
        const totalProposals = this.pendingChannelProposals.size;
        const messagesSent = this.messageHistory.size;
        
        return {
            totalPeers: this.peers.size,
            activePeers,
            totalProposals,
            messagesSent,
            uptime: process.uptime()
        };
    }
    
    /**
     * DIAGNOSTIC: Retourne des informations détaillées pour debug
     */
    getDiagnosticInfo() {
        return {
            port: this.port,
            peersCount: this.peers.size,
            activePeersCount: Array.from(this.peers.values()).filter(p => p.connected).length,
            pendingProposalsCount: this.pendingChannelProposals.size,
            messageHistorySize: this.messageHistory.size,
            handlerTypes: Array.from(this.messageHandlers.keys()),
            peers: Array.from(this.peers.entries()).map(([addr, peer]) => ({
                address: addr,
                connected: peer.connected,
                lastSeen: peer.lastSeen,
                capabilities: peer.nodeInfo?.capabilities || []
            })),
            proposals: Array.from(this.pendingChannelProposals.values()).map(prop => ({
                id: prop.id,
                status: prop.status,
                peer: prop.peer,
                receivedAt: prop.receivedAt
            }))
        };
    }
}

module.exports = P2PManager;