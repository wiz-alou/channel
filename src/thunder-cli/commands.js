/**
 * DESCRIPTION:
 * Implémente toutes les commandes CLI pour Thunder Payment Channels.
 * Communique avec l'API REST du serveur thunderd via HTTP.
 * 
 * FONCTIONNALITÉS:
 * - Gestion des wallets et balances
 * - Nouveau workflow P2P pour les channels
 * - Paiements off-chain
 * - Interface utilisateur claire avec instructions
 * 
 * WORKFLOW P2P IMPLÉMENTÉ:
 * 1. proposeChannel() - Propose un channel à un peer
 * 2. acceptChannel() - Accepte une proposition reçue
 * 3. createChannel() - Crée le smart contract
 * 4. fundChannel() - Finance sa part du channel
 * 5. listProposals() - Liste toutes les propositions
 * 
 * GESTION D'ERREURS:
 * - Connexion au node thunderd
 * - Validation des paramètres
 * - Messages d'aide contextuels
 */

const axios = require('axios');
const Utils = require('../shared/utils');

class Commands {
    constructor() {
        this.defaultTimeout = 10000; // 10 secondes
    }
    
    // === UTILITAIRE HTTP ===
    
    /**
     * Effectue une requête HTTP vers le serveur thunderd
     */
    async makeRequest(url, method = 'GET', data = null) {
        try {
            const config = {
                method,
                url,
                timeout: this.defaultTimeout,
                headers: {
                    'Content-Type': 'application/json'
                }
            };
            
            if (data) {
                config.data = data;
            }
            
            const response = await axios(config);
            return response.data;
        } catch (error) {
            if (error.code === 'ECONNREFUSED') {
                console.error('❌ Cannot connect to Thunder node.');
                console.error('   Make sure thunderd is running on the specified port.');
                console.error('   Start with: npm run thunderd');
                process.exit(1);
            }
            
            if (error.response) {
                console.error('❌ API Error:', error.response.data.error || error.response.statusText);
            } else {
                console.error('❌ Request failed:', error.message);
            }
            process.exit(1);
        }
    }
    
    // === COMMANDES DE BASE ===
    
    /**
     * Affiche les informations du node (port, peers, channels, propositions)
     */
    async infos(nodeUrl) {
        try {
            console.log('📊 Thunder Node Information');
            console.log('==========================');
            
            const response = await this.makeRequest(`${nodeUrl}/infos`);
            
            console.log(`Port: ${response.port}`);
            console.log(`Wallet: ${response.wallet || 'Not imported'}`);
            
            // Peers connectés
            console.log(`Connected Peers: ${response.connectedPeers.length}`);
            if (response.connectedPeers.length > 0) {
                response.connectedPeers.forEach((peer, index) => {
                    console.log(`  ${index + 1}. ${peer.host}:${peer.port} (connected at ${new Date(peer.connectedAt).toLocaleString()})`);
                });
            }
            
            // Channels actifs
            console.log(`Active Channels: ${response.channels.length}`);
            if (response.channels.length > 0) {
                response.channels.forEach((channel, index) => {
                    console.log(`  ${index + 1}. Channel ${channel.id}`);
                    console.log(`     State: ${channel.state}`);
                    console.log(`     Amount: ${this.formatAmount(channel.amount)} THD`);
                    console.log(`     Address: ${Utils.formatAddress(channel.address)}`);
                });
            }
            
            // Propositions en attente
            if (response.pendingProposals) {
                console.log(`Pending Proposals: ${response.pendingProposals.length}`);
                if (response.pendingProposals.length > 0) {
                    response.pendingProposals.forEach((proposal, index) => {
                        console.log(`  ${index + 1}. ${proposal.id} (${proposal.status})`);
                    });
                }
            }
            
            // Informations blockchain
            if (response.blockchain) {
                console.log(`Blockchain:`);
                console.log(`  Account: ${response.blockchain.account || 'Not set'}`);
                console.log(`  THD Token: ${response.blockchain.thdToken || 'Not deployed'}`);
            }
            
        } catch (error) {
            console.error('Failed to get node information');
        }
    }
    
    /**
     * Importe un wallet à partir d'une seed phrase
     */
    async importWallet(nodeUrl, seedPhrase) {
        try {
            console.log('🔐 Importing wallet...');
            
            // Pour la démo, utilise des clés privées prédéfinies
            const privateKeys = {
                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about": "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
                "test test test test test test test test test test test junk": "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
            };
            
            const privateKey = privateKeys[seedPhrase] || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
            
            const response = await this.makeRequest(`${nodeUrl}/importwallet`, 'POST', {
                seedPhrase,
                privateKey
            });
            
            if (response.success) {
                console.log(`✅ Wallet imported successfully`);
                console.log(`   Address: ${response.address}`);
                console.log('');
                console.log(`💡 Next steps:`);
                console.log(`   1. Check balance: thunder-cli balance`);
                console.log(`   2. Connect to peer: thunder-cli connect <ip:port>`);
                console.log(`   3. Propose channel: thunder-cli proposechannel <peer> <amount>`);
            } else {
                console.error('❌ Failed to import wallet:', response.error);
            }
            
        } catch (error) {
            console.error('Failed to import wallet');
        }
    }
    
    /**
     * Affiche les balances THD (total, disponible, locké, channel)
     */
    async balance(nodeUrl) {
        try {
            console.log('💰 Account Balance');
            console.log('==================');
            
            const response = await this.makeRequest(`${nodeUrl}/balance`);
            
            if (response.success) {
                console.log(`Address: ${response.address}`);
                console.log(`Total THD: ${response.totalTHD}`);
                console.log(`Available THD: ${response.availableTHD}`);
                console.log(`Channel THD: ${response.channelTHD} (locked in channels)`);
                console.log(`Channel Balance: ${response.channelBalance} (your current balance in channels)`);
                
                // Explication pour l'utilisateur
                if (parseFloat(response.channelTHD) > 0) {
                    console.log('');
                    console.log('💡 Balance explanation:');
                    console.log('   - Total: Your complete THD balance');
                    console.log('   - Available: THD you can spend outside channels');
                    console.log('   - Channel THD: Your contribution locked in payment channels');
                    console.log('   - Channel Balance: Your current spendable balance within channels');
                }
            } else {
                console.error('❌ Failed to get balance:', response.error);
            }
            
        } catch (error) {
            console.error('Failed to get balance');
        }
    }
    
    /**
     * Se connecte à un autre node Thunder
     */
    async connect(nodeUrl, address) {
        try {
            console.log(`🔗 Connecting to ${address}...`);
            
            const [host, port] = address.split(':');
            if (!host || !port) {
                console.error('❌ Invalid address format. Use: ip:port (example: localhost:2002)');
                return;
            }
            
            const response = await this.makeRequest(`${nodeUrl}/connect`, 'POST', {
                host,
                port: parseInt(port)
            });
            
            if (response.success) {
                console.log(`✅ ${response.message}`);
                console.log('');
                console.log(`💡 Next steps:`);
                console.log(`   1. Propose channel: thunder-cli proposechannel ${address} 10`);
                console.log(`   2. Check connection: thunder-cli infos`);
            } else {
                console.error('❌ Failed to connect:', response.error);
            }
            
        } catch (error) {
            console.error('Failed to connect to peer');
        }
    }
    
    // === NOUVEAU WORKFLOW P2P ===
    
    /**
     * Propose un channel à un peer connecté
     */
    async proposeChannel(nodeUrl, peer, amount) {
        try {
            console.log(`📋 Proposing channel to ${peer} with ${amount} THD...`);
            
            const response = await this.makeRequest(`${nodeUrl}/proposechannel`, 'POST', {
                peerAddress: peer,
                amount
            });
            
            if (response.success) {
                console.log(`✅ ${response.message}`);
                console.log(`   Proposal ID: ${response.proposal.id}`);
                console.log(`   Status: ${response.proposal.status}`);
                console.log('');
                console.log(`💡 What happens next:`);
                console.log(`   1. Your peer receives the proposal`);
                console.log(`   2. Peer accepts: thunder-cli --port <peer_port> acceptchannel ${response.proposal.id}`);
                console.log(`   3. You create channel: thunder-cli createchannel ${response.proposal.id}`);
                console.log(`   4. Both parties fund: thunder-cli fundchannel <channelId>`);
                console.log('');
                console.log(`📋 Track progress: thunder-cli proposals`);
            } else {
                console.error('❌ Failed to propose channel:', response.error);
            }
            
        } catch (error) {
            console.error('Failed to propose channel');
        }
    }
    
    /**
     * Accepte une proposition de channel reçue
     */
    async acceptChannel(nodeUrl, proposalId) {
        try {
            console.log(`✅ Accepting channel proposal ${proposalId}...`);
            
            const response = await this.makeRequest(`${nodeUrl}/acceptchannel`, 'POST', {
                proposalId
            });
            
            if (response.success) {
                console.log(`✅ ${response.message}`);
                console.log('');
                console.log(`💡 What happens next:`);
                console.log(`   1. Proposer creates the smart contract`);
                console.log(`   2. Proposer runs: thunder-cli createchannel ${proposalId}`);
                console.log(`   3. Both parties fund their part of the channel`);
                console.log('');
                console.log(`📋 Track progress: thunder-cli proposals`);
            } else {
                console.error('❌ Failed to accept channel:', response.error);
            }
            
        } catch (error) {
            console.error('Failed to accept channel');
        }
    }
    
    /**
     * Crée le smart contract à partir d'une proposition acceptée
     */
    async createChannel(nodeUrl, proposalId) {
        try {
            console.log(`🔓 Creating channel from proposal ${proposalId}...`);
            
            const response = await this.makeRequest(`${nodeUrl}/createchannel`, 'POST', {
                proposalId
            });
            
            if (response.success) {
                console.log(`✅ ${response.message}`);
                console.log(`   Channel ID: ${response.channel.id}`);
                console.log(`   Channel Address: ${response.channel.address}`);
                console.log(`   State: ${response.channel.state}`);
                console.log('');
                console.log(`💡 What happens next:`);
                console.log(`   1. Both parties need to fund the channel`);
                console.log(`   2. You fund: thunder-cli fundchannel ${response.channel.id}`);
                console.log(`   3. Peer funds: thunder-cli --port <peer_port> fundchannel ${response.channel.id}`);
                console.log(`   4. Channel becomes ACTIVE when both funded`);
                console.log('');
                console.log(`📊 Check status: thunder-cli infos`);
            } else {
                console.error('❌ Failed to create channel:', response.error);
            }
            
        } catch (error) {
            console.error('Failed to create channel');
        }
    }
    
    /**
     * Finance sa part d'un channel créé
     */
    async fundChannel(nodeUrl, channelId) {
        try {
            console.log(`💰 Funding channel ${channelId}...`);
            
            const response = await this.makeRequest(`${nodeUrl}/fundchannel`, 'POST', {
                channelId
            });
            
            if (response.success) {
                console.log(`✅ ${response.message}`);
                console.log(`   Channel State: ${response.channelState}`);
                
                if (response.bothFunded) {
                    console.log('');
                    console.log(`🎉 CHANNEL IS NOW ACTIVE!`);
                    console.log(`============================`);
                    console.log(`Both parties have funded the channel.`);
                    console.log(`You can now make instant off-chain payments!`);
                    console.log('');
                    console.log(`💸 Make payments: thunder-cli pay <amount>`);
                    console.log(`💰 Check balance: thunder-cli balance`);
                    console.log(`🔒 Close channel: thunder-cli closechannel`);
                } else {
                    console.log('');
                    console.log(`⏳ Waiting for other party to fund...`);
                    console.log(`The channel will become ACTIVE once both parties fund.`);
                    console.log('');
                    console.log(`📊 Check status: thunder-cli infos`);
                }
            } else {
                console.error('❌ Failed to fund channel:', response.error);
            }
            
        } catch (error) {
            console.error('Failed to fund channel');
        }
    }
    
    /**
     * Liste toutes les propositions de channels
     */
    async listProposals(nodeUrl) {
        try {
            console.log('📋 Channel Proposals');
            console.log('===================');
            
            const response = await this.makeRequest(`${nodeUrl}/proposals`);
            
            if (response.success) {
                const proposals = response.proposals;
                
                if (proposals.length === 0) {
                    console.log('No proposals found');
                    console.log('');
                    console.log('💡 Create a proposal: thunder-cli proposechannel <peer> <amount>');
                    return;
                }
                
                proposals.forEach((proposal, index) => {
                    console.log(`${index + 1}. Proposal ${proposal.id}`);
                    console.log(`   Status: ${proposal.status}`);
                    console.log(`   Amount: ${this.formatAmount(proposal.amount)} THD`);
                    console.log(`   Proposer: ${Utils.formatAddress(proposal.proposer)}`);
                    console.log(`   Acceptor: ${Utils.formatAddress(proposal.acceptor)}`);
                    console.log(`   Created: ${new Date(proposal.createdAt).toLocaleString()}`);
                    
                    // Instructions contextuelles selon le statut
                    if (proposal.status === 'PROPOSED') {
                        console.log(`   💡 Action: thunder-cli acceptchannel ${proposal.id}`);
                    } else if (proposal.status === 'ACCEPTED') {
                        console.log(`   💡 Action: thunder-cli createchannel ${proposal.id}`);
                    } else if (proposal.status === 'CREATED') {
                        console.log(`   💡 Action: thunder-cli fundchannel ${proposal.channelId}`);
                    }
                    
                    console.log('');
                });
            } else {
                console.error('❌ Failed to get proposals:', response.error);
            }
            
        } catch (error) {
            console.error('Failed to get proposals');
        }
    }
    
    // === PAIEMENTS ===
    
    /**
     * Envoie un paiement off-chain
     */
    async pay(nodeUrl, amount) {
        try {
            console.log(`💸 Sending payment of ${amount} THD...`);
            
            const response = await this.makeRequest(`${nodeUrl}/pay`, 'POST', {
                amount
            });
            
            if (response.success) {
                console.log(`✅ ${response.message}`);
                console.log(`   Payment ID: ${response.payment.id}`);
                console.log(`   New Nonce: ${response.payment.nonce}`);
                console.log('');
                console.log(`💡 Payment sent off-chain (instant & free!)`);
                console.log(`📊 Check balance: thunder-cli balance`);
            } else {
                console.error('❌ Failed to send payment:', response.error);
            }
            
        } catch (error) {
            console.error('Failed to send payment');
        }
    }
    
    /**
     * Ferme un channel actif
     */
    async closeChannel(nodeUrl) {
        try {
            console.log('🔒 Closing payment channel...');
            
            const response = await this.makeRequest(`${nodeUrl}/closechannel`, 'POST');
            
            if (response.success) {
                console.log(`✅ ${response.message}`);
                console.log(`   Block Number: ${response.blockNumber}`);
                console.log(`   ⏳ Challenge period: ${response.challengePeriod || 24} blocks`);
                console.log('');
                console.log(`💡 What happens next:`);
                console.log(`   1. Wait ${response.challengePeriod || 24} blocks for challenge period`);
                console.log(`   2. Mine blocks: npm run mine-blocks`);
                console.log(`   3. Withdraw funds: thunder-cli withdraw`);
            } else {
                console.error('❌ Failed to close channel:', response.error);
            }
            
        } catch (error) {
            console.error('Failed to close channel');
        }
    }
    
    /**
     * Retire les fonds d'un channel fermé
     */
    async withdraw(nodeUrl) {
        try {
            console.log('💳 Withdrawing funds from closed channel...');
            
            const response = await this.makeRequest(`${nodeUrl}/withdraw`, 'POST');
            
            if (response.success) {
                console.log(`✅ ${response.message}`);
                console.log(`   Transaction: ${response.transactionHash}`);
                console.log('');
                console.log(`🎉 Funds successfully withdrawn!`);
                console.log(`📊 Check balance: thunder-cli balance`);
            } else {
                console.error('❌ Failed to withdraw funds:', response.error);
            }
            
        } catch (error) {
            console.error('Failed to withdraw funds');
        }
    }
    
    // === RÉTROCOMPATIBILITÉ ===
    
    /**
     * Ancienne méthode d'ouverture de channel (dépréciée)
     */
    async openChannel(nodeUrl, amount) {
        try {
            console.log(`🔓 Opening payment channel with ${amount} THD...`);
            console.log(`⚠️  Using deprecated method - consider upgrading to P2P workflow`);
            
            const response = await this.makeRequest(`${nodeUrl}/openchannel`, 'POST', {
                amount
            });
            
            if (response.success) {
                console.log(`✅ ${response.message}`);
                console.log(`   Channel ID: ${response.channel.id}`);
                console.log(`   Channel Address: ${response.channel.address}`);
            } else {
                console.error('❌ Failed to open channel:', response.error);
            }
            
        } catch (error) {
            console.error('Failed to open channel');
        }
    }
    
    // === UTILITAIRES ===
    
    /**
     * Formate un montant en wei vers THD
     */
    formatAmount(amountWei) {
        try {
            const divisor = BigInt(10 ** 18);
            const amount = BigInt(amountWei);
            const wholePart = amount / divisor;
            return wholePart.toString();
        } catch (error) {
            return '0';
        }
    }
}

module.exports = Commands;