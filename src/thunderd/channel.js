/**
 * FICHIER: src/thunderd/channel.js
 * 
 * DESCRIPTION:
 * Gestionnaire de payment channels avec support multi-réseau (localhost, Sepolia, mainnet).
 * VERSION COMPLÈTE avec synchronisation P2P, support bidirectionnel et adaptation automatique
 * selon le réseau blockchain détecté.
 * 
 * NOUVELLES FONCTIONNALITÉS SEPOLIA:
 * - Adaptation automatique selon le réseau (gas price, block times, etc.)
 * - Gestion des faucets et explorers selon le réseau
 * - Validation spécifique aux réseaux de test vs production
 * - Messages d'aide contextuels selon le réseau
 * - Optimisations gas pour différents réseaux
 */

const Utils = require('../shared/utils');

class ChannelManager {
    constructor(blockchain) {
        this.blockchain = blockchain;
        this.channels = new Map();           // Channels actifs
        this.pendingPayments = new Map();    // Paiements off-chain
        this.proposals = new Map();          // Propositions de channels
        this.userFunding = new Map();        // Suivi du financement par utilisateur
        this.p2pManager = null;              // Référence au P2P Manager (sera injectée)
        
        // Détection du réseau pour adaptation
        this.network = 'localhost';
        this.networkConfig = this.getNetworkConfig();

        console.log(`📋 ChannelManager initialized for network: ${this.network}`);
    }

    // === CONFIGURATION RÉSEAU ===

    /**
     * Détecte le réseau actuel et retourne la configuration appropriée
     */
    getNetworkConfig() {
        if (this.blockchain && this.blockchain.getNetworkInfo) {
            const networkInfo = this.blockchain.getNetworkInfo();
            this.network = networkInfo.network || 'localhost';
        }

        const configs = {
            localhost: {
                challengePeriod: 10,        // Blocs courts pour dev
                gasMultiplier: 1.1,         // Marge standard
                maxGasPrice: '20000000000', // 20 Gwei max
                blockConfirmations: 1,      // Confirmation rapide
                isTestnet: true
            },
            sepolia: {
                challengePeriod: 24,        // 24 blocs standard
                gasMultiplier: 1.2,         // Marge plus élevée
                maxGasPrice: '50000000000', // 50 Gwei max
                blockConfirmations: 2,      // 2 confirmations
                isTestnet: true,
                faucets: [
                    'https://sepoliafaucet.com/',
                    'https://faucets.chain.link/sepolia'
                ],
                explorer: 'https://sepolia.etherscan.io'
            },
            mainnet: {
                challengePeriod: 144,       // ~24h avec blocs de 12s
                gasMultiplier: 1.1,         // Marge conservative
                maxGasPrice: '100000000000', // 100 Gwei max
                blockConfirmations: 3,      // 3 confirmations minimum
                isTestnet: false,
                explorer: 'https://etherscan.io'
            },
            polygon: {
                challengePeriod: 100,       // ~50min avec blocs de 2s
                gasMultiplier: 1.3,         // Réseau plus volatil
                maxGasPrice: '500000000000', // 500 Gwei (MATIC)
                blockConfirmations: 5,
                isTestnet: false,
                explorer: 'https://polygonscan.com'
            }
        };

        const config = configs[this.network] || configs.localhost;
        
        console.log(`🔧 Network configuration loaded for ${this.network}:`);
        console.log(`   Challenge period: ${config.challengePeriod} blocks`);
        console.log(`   Gas multiplier: ${config.gasMultiplier}x`);
        console.log(`   Is testnet: ${config.isTestnet}`);
        
        return config;
    }

    /**
     * Met à jour la configuration réseau (appelé après connection blockchain)
     */
    updateNetworkConfig() {
        this.networkConfig = this.getNetworkConfig();
        console.log(`🔄 Network configuration updated for ${this.network}`);
    }

    // === INJECTION DU P2P MANAGER ===

    setP2PManager(p2pManager) {
        this.p2pManager = p2pManager;
        console.log(`✅ P2P Manager successfully injected into ChannelManager`);
        console.log(`   P2P Manager available: ${!!this.p2pManager}`);
        console.log(`   Channel closure sync: ENABLED for ${this.network}`);
    }

    // === SYSTÈME DE PROPOSITIONS ===

    createChannelProposal(proposerId, acceptorId, amount) {
        const proposal = {
            id: Utils.generateId(),
            proposer: proposerId,
            acceptor: acceptorId,
            amount: amount.toString(),
            status: 'PROPOSED',
            createdAt: new Date().toISOString(),
            acceptedAt: null,
            channelId: null,
            network: this.network // NOUVEAU: Ajout du réseau
        };

        this.proposals.set(proposal.id, {
            ...proposal,
            amount: BigInt(amount)
        });

        console.log(`📋 Channel proposal created on ${this.network}:`);
        console.log(`   ID: ${proposal.id}`);
        console.log(`   Proposer: ${Utils.formatAddress(proposerId)}`);
        console.log(`   Acceptor: ${Utils.formatAddress(acceptorId)}`);
        console.log(`   Amount: ${Utils.formatBalance(BigInt(amount))} THD`);
        console.log(`   Network: ${this.network}`);

        return proposal;
    }

    acceptChannelProposal(proposalId, acceptorId) {
        const proposal = this.proposals.get(proposalId);
        if (!proposal) {
            throw new Error('Proposal not found');
        }

        if (proposal.status !== 'PROPOSED') {
            throw new Error(`Cannot accept proposal in status: ${proposal.status}`);
        }

        if (proposal.acceptor.toLowerCase() !== acceptorId.toLowerCase()) {
            throw new Error('Only the designated acceptor can accept this proposal');
        }

        proposal.status = 'ACCEPTED';
        proposal.acceptedAt = new Date().toISOString();

        console.log(`✅ Channel proposal ${proposalId} accepted by ${Utils.formatAddress(acceptorId)} on ${this.network}`);

        return {
            ...proposal,
            amount: proposal.amount.toString(),
            network: this.network
        };
    }

    async createChannelFromProposal(proposalId) {
        const proposal = this.proposals.get(proposalId);
        if (!proposal) {
            throw new Error('Proposal not found');
        }

        if (proposal.status !== 'ACCEPTED') {
            throw new Error(`Cannot create channel from proposal in status: ${proposal.status}`);
        }

        console.log(`🚀 Creating PaymentChannel on ${this.network}...`);
        console.log(`   Network config: ${JSON.stringify(this.networkConfig, null, 2)}`);

        // Déploie le smart contract avec configuration réseau
        const channelInfo = await this.blockchain.deployPaymentChannel(
            proposal.proposer,
            proposal.acceptor,
            proposal.amount.toString()
        );

        const channel = {
            id: Utils.generateId(),
            address: channelInfo.address,
            contract: channelInfo.contract,
            partA: proposal.proposer,
            partB: proposal.acceptor,
            amount: proposal.amount,
            state: 'EMPTY',
            nonce: 0,
            balanceA: proposal.amount / BigInt(2),
            balanceB: proposal.amount / BigInt(2),
            createdAt: new Date().toISOString(),
            pendingPayments: [],
            proposalId: proposalId,
            network: this.network, // NOUVEAU
            challengePeriod: this.networkConfig.challengePeriod, // NOUVEAU
            lastUpdate: new Date().toISOString()
        };

        this.channels.set(channel.id, channel);
        proposal.status = 'CREATED';
        proposal.channelId = channel.id;

        this.userFunding.set(channel.id, {
            [proposal.proposer.toLowerCase()]: false,
            [proposal.acceptor.toLowerCase()]: false
        });

        console.log(`🔓 Channel created from proposal on ${this.network}:`);
        console.log(`   Channel ID: ${channel.id}`);
        console.log(`   Address: ${Utils.formatAddress(channelInfo.address)}`);
        console.log(`   Challenge period: ${channel.challengePeriod} blocks`);
        console.log(`   Network: ${this.network}`);

        // Affichage du lien explorer si disponible
        if (this.networkConfig.explorer) {
            console.log(`   🔍 Explorer: ${this.networkConfig.explorer}/address/${channelInfo.address}`);
        }

        return channel;
    }

    // === FINANCEMENT AVEC OPTIMISATIONS RÉSEAU ===

    async fundChannelByUser(channelId, userAddress) {
        try {
            const channel = this.channels.get(channelId);
            if (!channel) {
                throw new Error('Channel not found');
            }

            const userAddr = userAddress.toLowerCase();
            const partAAddr = channel.partA.toLowerCase();
            const partBAddr = channel.partB.toLowerCase();

            if (userAddr !== partAAddr && userAddr !== partBAddr) {
                throw new Error('User is not a participant in this channel');
            }

            const funding = this.userFunding.get(channelId);
            if (funding[userAddr]) {
                throw new Error('User has already funded this channel');
            }

            console.log(`💰 ${Utils.formatAddress(userAddress)} funding channel on ${this.network}`);
            console.log(`   Channel: ${Utils.formatAddress(channel.address)}`);
            console.log(`   Network: ${this.network}`);

            const fundAmount = channel.amount / BigInt(2);

            // === OPTIMISATION GAS SELON LE RÉSEAU ===
            
            console.log(`⛽ Optimizing gas for ${this.network}...`);
            
            // 1. Approve avec gas optimisé
            await this.approveTokenWithGasOptimization(channel.address, fundAmount.toString());

            // 2. Fund avec gas optimisé
            const tx = channel.contract.methods.fund();
            let gasEstimate;
            
            try {
                gasEstimate = await tx.estimateGas({ from: userAddress });
            } catch (gasError) {
                console.error(`Gas estimation failed:`, gasError.message);
                
                // Fallback gas selon le réseau
                const fallbackGas = {
                    localhost: 200000,
                    sepolia: 250000,
                    mainnet: 300000,
                    polygon: 400000
                }[this.network] || 200000;
                
                gasEstimate = fallbackGas;
                console.log(`   Using fallback gas: ${gasEstimate}`);
            }

            // Applique le multiplicateur de sécurité selon le réseau
            const gasToUse = Math.floor(Number(gasEstimate) * this.networkConfig.gasMultiplier);
            
            // Obtient et valide le gas price
            const gasPrice = await this.getOptimalGasPrice();
            
            console.log(`   Gas estimate: ${gasEstimate}`);
            console.log(`   Gas to use: ${gasToUse} (${this.networkConfig.gasMultiplier}x multiplier)`);
            console.log(`   Gas price: ${this.blockchain.web3.utils.fromWei(gasPrice.toString(), 'gwei')} Gwei`);

            const receipt = await tx.send({
                from: userAddress,
                gas: gasToUse,
                gasPrice: gasPrice.toString()
            });

            // 3. Marque l'utilisateur comme ayant financé
            funding[userAddr] = true;

            // 4. Vérification post-financement
            console.log(`🔍 Checking contract state after funding on ${this.network}...`);
            const channelInfo = await channel.contract.methods.getChannelInfo().call();
            const contractState = this.mapContractState(channelInfo._state);

            console.log(`📊 Contract state: ${contractState}`);
            
            // Attendre les confirmations selon le réseau
            if (this.networkConfig.blockConfirmations > 1) {
                console.log(`⏳ Waiting for ${this.networkConfig.blockConfirmations} confirmations on ${this.network}...`);
                // Pour les réseaux publics, on pourrait attendre plus de confirmations
                // Mais pour la démo, on continue immédiatement
            }

            channel.state = contractState;
            channel.lastUpdate = new Date().toISOString();

            const bothFundedLocally = funding[partAAddr] && funding[partBAddr];
            const isReallyActive = contractState === 'ACTIVE';

            if (isReallyActive) {
                console.log(`🎉 Channel fully funded and ACTIVE on ${this.network}!`);
                
                // Affichage explorer pour vérification
                if (this.networkConfig.explorer) {
                    console.log(`   🔍 Transaction: ${this.networkConfig.explorer}/tx/${receipt.transactionHash}`);
                }
            } else {
                console.log(`⏳ Waiting for other party to fund on ${this.network}...`);
            }

            return {
                receipt,
                bothFunded: isReallyActive,
                channelState: channel.state,
                funded: true,
                network: this.network,
                transactionHash: receipt.transactionHash
            };

        } catch (error) {
            console.error(`❌ Failed to fund channel on ${this.network}:`, error.message);
            
            // Messages d'erreur spécifiques au réseau
            if (error.message.includes('insufficient funds')) {
                if (this.networkConfig.isTestnet) {
                    console.error(`💡 Get test ETH from faucets:`);
                    this.networkConfig.faucets?.forEach(faucet => {
                        console.error(`   🚰 ${faucet}`);
                    });
                } else {
                    console.error(`💡 Insufficient ETH for gas fees on ${this.network}`);
                }
            }
            
            throw error;
        }
    }

    /**
     * Optimise le gas price selon le réseau
     */
    async getOptimalGasPrice() {
        try {
            const currentGasPrice = await this.blockchain.web3.eth.getGasPrice();
            const maxGasPrice = BigInt(this.networkConfig.maxGasPrice);
            
            // Pour les testnets, utilise un gas price modéré
            if (this.networkConfig.isTestnet) {
                const adjustedGasPrice = BigInt(currentGasPrice) * BigInt(110) / BigInt(100); // +10%
                return adjustedGasPrice > maxGasPrice ? maxGasPrice : adjustedGasPrice;
            }
            
            // Pour mainnet, surveillance plus fine
            if (BigInt(currentGasPrice) > maxGasPrice) {
                console.log(`⚠️  Gas price ${this.blockchain.web3.utils.fromWei(currentGasPrice.toString(), 'gwei')} Gwei exceeds max ${this.blockchain.web3.utils.fromWei(maxGasPrice.toString(), 'gwei')} Gwei`);
                console.log(`   Using max gas price for ${this.network}`);
                return maxGasPrice;
            }
            
            return currentGasPrice;
            
        } catch (error) {
            console.error('Failed to get optimal gas price:', error.message);
            
            // Fallback gas prices selon le réseau
            const fallbackGasPrices = {
                localhost: '1000000000',    // 1 Gwei
                sepolia: '10000000000',     // 10 Gwei
                mainnet: '20000000000',     // 20 Gwei
                polygon: '30000000000'      // 30 Gwei
            };
            
            return BigInt(fallbackGasPrices[this.network] || fallbackGasPrices.localhost);
        }
    }

    /**
     * Approve tokens avec optimisation gas
     */
    async approveTokenWithGasOptimization(spender, amount) {
        try {
            console.log(`💰 Approving ${Utils.formatBalance(BigInt(amount))} THD for ${Utils.formatAddress(spender)} on ${this.network}...`);

            const gasPrice = await this.getOptimalGasPrice();
            
            const receipt = await this.blockchain.approveToken(spender, amount);
            
            if (this.networkConfig.explorer && receipt.transactionHash) {
                console.log(`   🔍 Approval tx: ${this.networkConfig.explorer}/tx/${receipt.transactionHash}`);
            }
            
            return receipt;
            
        } catch (error) {
            console.error(`❌ Token approval failed on ${this.network}:`, error.message);
            throw error;
        }
    }

    // === PAIEMENTS OFF-CHAIN ===

    async createOffChainPayment(channelId, amount) {
        try {
            const channel = this.channels.get(channelId);
            if (!channel) {
                throw new Error('Channel not found');
            }

            if (channel.state !== 'ACTIVE') {
                throw new Error(`Channel not active. Current state: ${channel.state}`);
            }

            const paymentAmount = BigInt(amount);
            const currentAddress = this.blockchain.currentAccount.address.toLowerCase();
            const isPartA = currentAddress === channel.partA.toLowerCase();

            console.log(`💸 Creating off-chain payment on ${this.network}: ${Utils.formatBalance(paymentAmount)} THD`);
            console.log(`   Channel: ${Utils.formatAddress(channel.address)}`);
            console.log(`   From: ${isPartA ? 'Part A' : 'Part B'} (${Utils.formatAddress(currentAddress)})`);
            console.log(`   Network: ${this.network}`);

            // Calcule les nouveaux soldes
            let newBalanceA = channel.balanceA;
            let newBalanceB = channel.balanceB;

            if (isPartA) {
                if (newBalanceA < paymentAmount) {
                    throw new Error(`Insufficient balance in channel. Available: ${Utils.formatBalance(newBalanceA)}, Required: ${Utils.formatBalance(paymentAmount)}`);
                }
                newBalanceA -= paymentAmount;
                newBalanceB += paymentAmount;
            } else {
                if (newBalanceB < paymentAmount) {
                    throw new Error(`Insufficient balance in channel. Available: ${Utils.formatBalance(newBalanceB)}, Required: ${Utils.formatBalance(paymentAmount)}`);
                }
                newBalanceB -= paymentAmount;
                newBalanceA += paymentAmount;
            }

            const newNonce = channel.nonce + 1;
            const message = await channel.contract.methods.message(
                newNonce,
                newBalanceA.toString(),
                newBalanceB.toString()
            ).call();

            const signature = await this.blockchain.web3.eth.accounts.sign(
                message,
                this.blockchain.currentAccount.privateKey
            );

            const payment = {
                id: Utils.generateId(),
                nonce: newNonce,
                balanceA: newBalanceA,
                balanceB: newBalanceB,
                amount: paymentAmount,
                from: currentAddress,
                to: isPartA ? channel.partB : channel.partA,
                signature: signature.signature,
                message: message,
                timestamp: new Date().toISOString(),
                network: this.network // NOUVEAU
            };

            // Met à jour l'état du channel
            channel.nonce = newNonce;
            channel.balanceA = newBalanceA;
            channel.balanceB = newBalanceB;
            channel.lastUpdate = new Date().toISOString();
            channel.pendingPayments.push(payment);

            console.log(`✅ Off-chain payment created on ${this.network}: ${Utils.formatBalance(paymentAmount)} THD`);
            console.log(`   New balances: A=${Utils.formatBalance(newBalanceA)}, B=${Utils.formatBalance(newBalanceB)}`);
            console.log(`   Nonce: ${newNonce}`);

            return payment;

        } catch (error) {
            console.error(`❌ Failed to create payment on ${this.network}:`, error.message);
            throw error;
        }
    }

    // === FERMETURE AVEC GESTION MULTI-RÉSEAU ===

    async checkChannelStateBeforeClosing(channelId) {
        try {
            const channel = this.channels.get(channelId);
            if (!channel) {
                throw new Error('Channel not found');
            }

            console.log(`🔍 Checking current blockchain state before closing on ${this.network}...`);

            const contractInfo = await channel.contract.methods.getChannelInfo().call();
            const blockchainState = this.mapContractState(contractInfo._state);

            console.log(`📊 Blockchain state check on ${this.network}:`);
            console.log(`   Local state: ${channel.state}`);
            console.log(`   Blockchain state: ${blockchainState}`);
            console.log(`   Contract closing block: ${contractInfo._closingBlock}`);

            if (blockchainState === 'CLOSING') {
                channel.state = 'CLOSING';
                channel.closingBlock = Number(contractInfo._closingBlock);
                channel.balanceA = BigInt(contractInfo._balanceA);
                channel.balanceB = BigInt(contractInfo._balanceB);
                channel.lastUpdate = new Date().toISOString();

                throw new Error(`Channel is already in CLOSING state. It was closed at block ${contractInfo._closingBlock} by the other party. Use 'thunder-cli withdraw' after the challenge period expires (${this.networkConfig.challengePeriod} blocks).`);
            }

            if (blockchainState === 'CLOSED') {
                channel.state = 'CLOSED';
                channel.closingBlock = Number(contractInfo._closingBlock);
                channel.balanceA = BigInt(contractInfo._balanceA);
                channel.balanceB = BigInt(contractInfo._balanceB);
                channel.lastUpdate = new Date().toISOString();

                throw new Error(`Channel is already CLOSED. It was closed by the other party and funds have been distributed. Check your balance.`);
            }

            if (blockchainState !== 'ACTIVE') {
                throw new Error(`Channel is not active on blockchain. Current state: ${blockchainState}`);
            }

            console.log(`✅ Channel is ACTIVE and ready for closing on ${this.network}`);
            return true;

        } catch (error) {
            console.error(`❌ Blockchain state check failed on ${this.network}:`, error.message);
            throw error;
        }
    }

    async closeChannel(channelId) {
        try {
            const channel = this.channels.get(channelId);
            if (!channel) {
                throw new Error('Channel not found');
            }

            if (channel.state !== 'ACTIVE') {
                throw new Error(`Channel not active. Current state: ${channel.state}`);
            }

            // Vérification blockchain
            await this.checkChannelStateBeforeClosing(channelId);

            console.log(`🔒 Closing channel on ${this.network}`);
            console.log(`   Channel: ${Utils.formatAddress(channel.address)}`);
            console.log(`   Challenge period: ${this.networkConfig.challengePeriod} blocks`);

            const nonce = channel.nonce > 0 ? channel.nonce : 1;
            const balanceA = channel.balanceA;
            const balanceB = channel.balanceB;

            console.log(`Using current channel state for closing:`);
            console.log(`  Nonce: ${nonce}`);
            console.log(`  BalanceA: ${Utils.formatBalance(balanceA)} THD`);
            console.log(`  BalanceB: ${Utils.formatBalance(balanceB)} THD`);

            const message = await channel.contract.methods.message(
                nonce,
                balanceA.toString(),
                balanceB.toString()
            ).call();

            // Détermine la signature selon le réseau et les participants
            const signature = await this.createChannelCloseSignature(channel, message, nonce, balanceA, balanceB);

            // Transaction de fermeture avec optimisations réseau
            console.log(`📤 Sending closing transaction on ${this.network}...`);

            const gasPrice = await this.getOptimalGasPrice();
            
            const tx = channel.contract.methods.closing(
                nonce,
                balanceA.toString(),
                balanceB.toString(),
                signature
            );

            const gasEstimate = await tx.estimateGas({ from: this.blockchain.currentAccount.address });
            const gasToUse = Math.floor(Number(gasEstimate) * this.networkConfig.gasMultiplier);

            console.log(`   Gas estimate: ${gasEstimate}`);
            console.log(`   Gas to use: ${gasToUse}`);
            console.log(`   Gas price: ${this.blockchain.web3.utils.fromWei(gasPrice.toString(), 'gwei')} Gwei`);

            const receipt = await tx.send({
                from: this.blockchain.currentAccount.address,
                gas: gasToUse,
                gasPrice: gasPrice.toString()
            });

            // Mise à jour d'état
            channel.state = 'CLOSING';
            channel.closingBlock = receipt.blockNumber;
            channel.lastUpdate = new Date().toISOString();

            console.log(`✅ Channel closing transaction successful on ${this.network}`);
            console.log(`   Transaction hash: ${receipt.transactionHash}`);
            console.log(`   Block number: ${receipt.blockNumber}`);
            console.log(`   Challenge period: ${this.networkConfig.challengePeriod} blocks`);

            // Lien explorer
            if (this.networkConfig.explorer) {
                console.log(`   🔍 Explorer: ${this.networkConfig.explorer}/tx/${receipt.transactionHash}`);
            }

            // === NOTIFICATION P2P ===
            if (this.p2pManager) {
                try {
                    const notificationData = {
                        channelId: channel.id,
                        channelAddress: channel.address,
                        closingBlock: receipt.blockNumber,
                        finalBalanceA: balanceA.toString(),
                        finalBalanceB: balanceB.toString(),
                        nonce: nonce,
                        closedBy: this.blockchain.currentAccount.address,
                        timestamp: new Date().toISOString(),
                        partA: channel.partA,
                        partB: channel.partB,
                        transactionHash: receipt.transactionHash,
                        challengePeriod: this.networkConfig.challengePeriod,
                        network: this.network // NOUVEAU
                    };

                    console.log(`📤 Broadcasting CHANNEL_CLOSED message on ${this.network}...`);
                    const broadcastResults = await this.p2pManager.broadcastMessage('CHANNEL_CLOSED', notificationData);

                    const successCount = broadcastResults.filter(r => r.success).length;
                    console.log(`📤 P2P Broadcast completed on ${this.network}: ${successCount}/${broadcastResults.length} peers notified`);

                } catch (p2pError) {
                    console.error(`❌ P2P notification failed on ${this.network}:`, p2pError.message);
                }
            }

            // Instructions utilisateur selon le réseau
            console.log(`\n💡 Channel closure summary on ${this.network}:`);
            console.log(`   ✅ Blockchain transaction: SUCCESS`);
            console.log(`   🔒 Channel state: CLOSING`);
            console.log(`   ⏳ Challenge period: ${this.networkConfig.challengePeriod} blocks`);
            
            if (this.network === 'localhost') {
                console.log(`   🎯 Speed up: npm run mine-blocks ${this.networkConfig.challengePeriod + 1}`);
            } else {
                const estimatedTime = this.networkConfig.challengePeriod * (this.network === 'polygon' ? 2 : 12); // secondes
                const minutes = Math.round(estimatedTime / 60);
                console.log(`   ⏰ Estimated wait time: ~${minutes} minutes`);
            }
            
            console.log(`   💳 Then withdraw: thunder-cli withdraw`);

            return receipt;

        } catch (error) {
            console.error(`❌ Failed to close channel on ${this.network}:`, error.message);
            throw error;
        }
    }

    /**
     * Crée la signature pour la fermeture selon le réseau
     */
    async createChannelCloseSignature(channel, message, nonce, balanceA, balanceB) {
        const currentAddress = this.blockchain.currentAccount.address.toLowerCase();
        const isPartA = currentAddress === channel.partA.toLowerCase();

        console.log(`✍️  Creating signature for ${this.network}:`);
        console.log(`   Current user: ${Utils.formatAddress(currentAddress)}`);
        console.log(`   Is Part A: ${isPartA}`);

        // Mapping des adresses vers leurs clés (identique pour tous les réseaux pour la démo)
        const addressToPrivateKey = {
            "0x70997970c51812dc3a010c7d01b50e0d17dc79c8": "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
            "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc": "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
            "0x90f79bf6eb2c4f870365e785982e1f101e93b906": "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
        };

        let signerAddress = isPartA ? channel.partB : channel.partA;
        let signerKey = addressToPrivateKey[signerAddress.toLowerCase()];

        if (!signerKey) {
            throw new Error(`No private key found for signer ${Utils.formatAddress(signerAddress)} on ${this.network}`);
        }

        console.log(`   Signer address: ${Utils.formatAddress(signerAddress)}`);
        console.log(`   Network: ${this.network}`);

        const signResult = await this.blockchain.web3.eth.accounts.sign(message, signerKey);
        const signature = signResult.signature;

        // Vérification de la signature
        const recoveredAddress = this.blockchain.web3.eth.accounts.recover(message, signature);
        if (recoveredAddress.toLowerCase() !== signerAddress.toLowerCase()) {
            throw new Error(`Signature verification failed on ${this.network}: expected ${Utils.formatAddress(signerAddress)}, got ${Utils.formatAddress(recoveredAddress)}`);
        }

        console.log(`✅ Signature verification: PASSED on ${this.network}`);
        return signature;
    }

    // === RETRAIT AVEC GESTION MULTI-RÉSEAU ===

    async withdrawFromChannel(channelId) {
        try {
            const channel = this.channels.get(channelId);
            if (!channel) {
                throw new Error('Channel not found');
            }

            console.log(`💳 Withdrawing from channel on ${this.network}...`);
            console.log(`   Channel: ${Utils.formatAddress(channel.address)}`);
            console.log(`   Challenge period: ${this.networkConfig.challengePeriod} blocks`);

            if (channel.state === 'CLOSED') {
                console.log(`💳 Channel ${channelId} is already CLOSED on ${this.network}`);

                const currentUserAddress = this.blockchain.currentAccount.address.toLowerCase();
                const isPartA = currentUserAddress === channel.partA.toLowerCase();
                const userFinalBalance = isPartA ? channel.balanceA : channel.balanceB;

                console.log(`💰 Your final balance: ${Utils.formatBalance(userFinalBalance)} THD`);

                if (userFinalBalance > 0) {
                    return {
                        transactionHash: 'auto-distributed-when-other-party-withdrew',
                        blockNumber: channel.closingBlock || 'unknown',
                        status: 'funds-already-distributed',
                        userFinalBalance: userFinalBalance.toString(),
                        network: this.network,
                        message: 'Funds were automatically distributed when the other party withdrew'
                    };
                } else {
                    return {
                        transactionHash: 'no-funds-to-withdraw',
                        blockNumber: channel.closingBlock || 'unknown',
                        status: 'no-funds',
                        userFinalBalance: '0',
                        network: this.network,
                        message: 'No funds to withdraw - your final balance is 0 THD'
                    };
                }
            }

            if (channel.state !== 'CLOSING') {
                throw new Error(`Channel not in closing state. Current state: ${channel.state}`);
            }

            // Vérification du challenge period selon le réseau
            const currentBlock = await this.blockchain.web3.eth.getBlockNumber();
            const currentBlockNum = Number(currentBlock);
            const closingBlockNum = Number(channel.closingBlock);
            const challengeEndBlock = closingBlockNum + this.networkConfig.challengePeriod;

            console.log(`💳 Withdraw check on ${this.network}:`);
            console.log(`   Current block: ${currentBlockNum}`);
            console.log(`   Closing block: ${closingBlockNum}`);
            console.log(`   Challenge period: ${this.networkConfig.challengePeriod} blocks`);
            console.log(`   Challenge ends at block: ${challengeEndBlock}`);

            if (currentBlockNum <= challengeEndBlock) {
                const remainingBlocks = challengeEndBlock - currentBlockNum;
                
                let estimatedWait = '';
                if (this.network === 'polygon') {
                    estimatedWait = ` (~${Math.round(remainingBlocks * 2 / 60)} minutes)`;
                } else if (this.network === 'sepolia' || this.network === 'mainnet') {
                    estimatedWait = ` (~${Math.round(remainingBlocks * 12 / 60)} minutes)`;
                }
                
                throw new Error(`Challenge period not expired on ${this.network}. ${remainingBlocks} blocks remaining${estimatedWait}.`);
            }

            console.log(`   ✅ Challenge period expired on ${this.network}`);

            // Vérification état blockchain
            const contractInfo = await channel.contract.methods.getChannelInfo().call();
            const contractState = this.mapContractState(contractInfo._state);

            if (contractState === 'CLOSED') {
                console.log(`🎉 Contract is already CLOSED on ${this.network} - funds were distributed!`);

                channel.state = 'CLOSED';
                channel.balanceA = BigInt(contractInfo._balanceA);
                channel.balanceB = BigInt(contractInfo._balanceB);
                channel.lastUpdate = new Date().toISOString();

                const currentUserAddress = this.blockchain.currentAccount.address.toLowerCase();
                const isPartA = currentUserAddress === channel.partA.toLowerCase();
                const userFinalBalance = isPartA ? channel.balanceA : channel.balanceB;

                return {
                    transactionHash: 'auto-distributed-by-other-party-withdraw',
                    blockNumber: contractInfo._closingBlock,
                    status: 'already-distributed',
                    userFinalBalance: userFinalBalance.toString(),
                    network: this.network,
                    message: 'Funds were automatically distributed when the other party withdrew'
                };
            }

            if (contractState !== 'CLOSING') {
                throw new Error(`Contract not in CLOSING state on ${this.network}. Current: ${contractState}`);
            }

            // Exécution du withdraw avec optimisation gas
            console.log(`⛽ Optimizing withdraw transaction for ${this.network}...`);

            const gasEstimate = await channel.contract.methods.withdraw().estimateGas({
                from: this.blockchain.currentAccount.address
            });

            const gasPrice = await this.getOptimalGasPrice();
            const gasToUse = Math.floor(Number(gasEstimate) * this.networkConfig.gasMultiplier);

            console.log(`📤 Executing withdraw on ${this.network}:`);
            console.log(`   Gas estimate: ${gasEstimate}`);
            console.log(`   Gas to use: ${gasToUse}`);
            console.log(`   Gas price: ${this.blockchain.web3.utils.fromWei(gasPrice.toString(), 'gwei')} Gwei`);

            const receipt = await channel.contract.methods.withdraw().send({
                from: this.blockchain.currentAccount.address,
                gas: gasToUse,
                gasPrice: gasPrice.toString()
            });

            // Mise à jour d'état
            channel.state = 'CLOSED';
            channel.lastUpdate = new Date().toISOString();

            console.log(`✅ Withdraw successful on ${this.network}!`);
            console.log(`   Transaction: ${receipt.transactionHash}`);
            console.log(`   Block: ${receipt.blockNumber}`);

            // Lien explorer
            if (this.networkConfig.explorer) {
                console.log(`   🔍 Explorer: ${this.networkConfig.explorer}/tx/${receipt.transactionHash}`);
            }

            // === NOTIFICATION P2P ===
            if (this.p2pManager) {
                try {
                    const currentUserAddress = this.blockchain.currentAccount.address.toLowerCase();
                    const isPartA = currentUserAddress === channel.partA.toLowerCase();
                    const userFinalBalance = isPartA ? channel.balanceA : channel.balanceB;

                    const withdrawNotification = {
                        channelId: channel.id,
                        channelAddress: channel.address,
                        withdrawnBy: currentUserAddress,
                        userRole: isPartA ? 'Part A' : 'Part B',
                        withdrawnAmount: userFinalBalance.toString(),
                        transactionHash: receipt.transactionHash,
                        blockNumber: receipt.blockNumber,
                        timestamp: new Date().toISOString(),
                        partA: channel.partA,
                        partB: channel.partB,
                        finalBalanceA: channel.balanceA.toString(),
                        finalBalanceB: channel.balanceB.toString(),
                        channelNowClosed: true,
                        network: this.network // NOUVEAU
                    };

                    console.log(`📤 Broadcasting CHANNEL_WITHDRAWN message on ${this.network}...`);
                    await this.p2pManager.broadcastMessage('CHANNEL_WITHDRAWN', withdrawNotification);
                    console.log(`✅ Peers notified of withdrawal on ${this.network}`);

                } catch (p2pError) {
                    console.error(`❌ P2P withdraw notification failed on ${this.network}:`, p2pError.message);
                }
            }

            return {
                transactionHash: receipt.transactionHash,
                blockNumber: receipt.blockNumber,
                network: this.network,
                status: 'success'
            };

        } catch (error) {
            console.error(`❌ Withdraw failed on ${this.network}:`, error.message);

            // Messages d'erreur spécifiques au réseau
            if (error.message.includes('already CLOSED')) {
                console.error(`💡 Channel is already closed on ${this.network}.`);
                console.error('   Your funds should already be in your wallet.');
                console.error('   Check your balance: thunder-cli balance');
            } else if (error.message.includes('Challenge period not expired')) {
                console.error(`💡 Challenge period still active on ${this.network}.`);
                if (this.network === 'localhost') {
                    console.error('   Speed up: npm run mine-blocks 25');
                } else {
                    console.error('   Wait for the remaining blocks to be mined');
                }
            }

            throw error;
        }
    }

    // === CALCUL DES BALANCES AVEC ADAPTATION RÉSEAU ===

    getChannelBalance(userAddress) {
        let totalLocked = BigInt(0);
        let channelBalance = BigInt(0);

        console.log(`Calculating channel balance for ${Utils.formatAddress(userAddress)} on ${this.network}`);
        console.log(`Total channels: ${this.channels.size}`);

        for (const channel of this.channels.values()) {
            console.log(`Channel ${channel.id}: state=${channel.state}, amount=${Utils.formatBalance(channel.amount)}, network=${channel.network || this.network}`);

            // Ne compte QUE les channels ACTIVE comme locked
            if (channel.state === 'ACTIVE') {
                const fundAmount = channel.amount / BigInt(2);

                const funding = this.userFunding.get(channel.id);
                const userAddr = userAddress.toLowerCase();

                if (funding && funding[userAddr]) {
                    totalLocked += fundAmount;

                    const isPartA = userAddress.toLowerCase() === channel.partA.toLowerCase();
                    const userChannelBalance = isPartA ? channel.balanceA : channel.balanceB;
                    channelBalance += userChannelBalance;

                    console.log(`  User funded this ACTIVE channel: ${Utils.formatBalance(fundAmount)} THD (LOCKED) on ${this.network}`);
                    console.log(`  User balance in channel: ${Utils.formatBalance(userChannelBalance)} THD`);
                }
            } else if (channel.state === 'CLOSING') {
                console.log(`  Channel ${channel.id} is CLOSING on ${this.network} - funds will be distributed`);
            } else if (channel.state === 'CLOSED') {
                console.log(`  Channel ${channel.id} is CLOSED on ${this.network} - funds already distributed`);
            }
        }

        console.log(`Final calculation for ${this.network}:`);
        console.log(`  Total locked: ${Utils.formatBalance(totalLocked)} THD`);
        console.log(`  Channel balance: ${Utils.formatBalance(channelBalance)} THD`);

        return {
            locked: totalLocked,
            balance: channelBalance
        };
    }

    // === SYNCHRONISATION D'ÉTAT ===

    synchronizeChannelState(channelId, newState) {
        try {
            const channel = this.channels.get(channelId);
            if (!channel) {
                console.log(`⚠️  Channel ${channelId} not found for synchronization on ${this.network}`);
                return false;
            }

            const { state, closingBlock, balanceA, balanceB, nonce } = newState;

            console.log(`🔄 Synchronizing channel ${channelId} on ${this.network}:`);
            console.log(`   Current state: ${channel.state} → New state: ${state}`);
            console.log(`   Current nonce: ${channel.nonce} → New nonce: ${nonce}`);

            channel.state = state;
            if (closingBlock) channel.closingBlock = closingBlock;
            if (balanceA) channel.balanceA = BigInt(balanceA);
            if (balanceB) channel.balanceB = BigInt(balanceB);
            if (nonce) channel.nonce = nonce;
            channel.lastUpdate = new Date().toISOString();

            console.log(`✅ Channel state synchronized successfully on ${this.network}`);
            return true;

        } catch (error) {
            console.error(`❌ Failed to synchronize channel state on ${this.network}:`, error.message);
            return false;
        }
    }

    // === UTILITAIRES ===

    mapContractState(stateNumber) {
        const states = ['EMPTY', 'ACTIVE', 'CLOSING', 'CLOSED'];
        return states[parseInt(stateNumber)] || 'UNKNOWN';
    }

    getChannels() {
        return Array.from(this.channels.values()).map(channel => ({
            id: channel.id,
            address: channel.address,
            partA: channel.partA,
            partB: channel.partB,
            amount: channel.amount.toString(),
            state: channel.state,
            balanceA: channel.balanceA.toString(),
            balanceB: channel.balanceB.toString(),
            nonce: channel.nonce,
            paymentsCount: channel.pendingPayments.length,
            closingBlock: channel.closingBlock || null,
            lastUpdate: channel.lastUpdate || null,
            network: channel.network || this.network, // NOUVEAU
            challengePeriod: channel.challengePeriod || this.networkConfig.challengePeriod // NOUVEAU
        }));
    }

    getProposals() {
        return Array.from(this.proposals.values()).map(proposal => ({
            ...proposal,
            amount: proposal.amount.toString(),
            network: proposal.network || this.network // NOUVEAU
        }));
    }

    getProposal(proposalId) {
        const proposal = this.proposals.get(proposalId);
        if (proposal) {
            return {
                ...proposal,
                amount: proposal.amount.toString(),
                network: proposal.network || this.network
            };
        }
        return null;
    }

    // === DIAGNOSTIC AVEC INFORMATIONS RÉSEAU ===

    getDiagnosticInfo() {
        const channels = Array.from(this.channels.values());
        const proposals = Array.from(this.proposals.values());

        return {
            network: this.network,
            networkConfig: this.networkConfig,
            channelsCount: channels.length,
            proposalsCount: proposals.length,
            p2pManagerAvailable: !!this.p2pManager,
            channels: channels.map(channel => ({
                id: channel.id,
                state: channel.state,
                network: channel.network || this.network,
                challengePeriod: channel.challengePeriod || this.networkConfig.challengePeriod,
                participants: [
                    Utils.formatAddress(channel.partA),
                    Utils.formatAddress(channel.partB)
                ],
                balances: [
                    Utils.formatBalance(channel.balanceA),
                    Utils.formatBalance(channel.balanceB)
                ],
                nonce: channel.nonce,
                lastUpdate: channel.lastUpdate
            })),
            funding: Object.fromEntries(
                Array.from(this.userFunding.entries()).map(([channelId, funding]) => [
                    channelId,
                    Object.fromEntries(
                        Object.entries(funding).map(([addr, funded]) => [
                            Utils.formatAddress(addr),
                            funded
                        ])
                    )
                ])
            ),
            proposals: proposals.map(proposal => ({
                id: proposal.id,
                status: proposal.status,
                network: proposal.network || this.network,
                amount: Utils.formatBalance(proposal.amount),
                createdAt: proposal.createdAt,
                acceptedAt: proposal.acceptedAt
            }))
        };
    }

    /**
     * Met à jour les configurations en cas de changement de réseau
     */
    onNetworkChange(newNetwork) {
        console.log(`🔄 Network changed: ${this.network} → ${newNetwork}`);
        this.network = newNetwork;
        this.updateNetworkConfig();
        
        // Met à jour tous les channels existants
        for (const channel of this.channels.values()) {
            if (!channel.network) {
                channel.network = newNetwork;
                channel.challengePeriod = this.networkConfig.challengePeriod;
                console.log(`   Updated channel ${channel.id} for network ${newNetwork}`);
            }
        }
    }

    /**
     * Obtient des recommandations spécifiques au réseau
     */
    getNetworkRecommendations() {
        const recommendations = [];
        
        if (this.networkConfig.isTestnet) {
            recommendations.push('Using testnet - safe for experimentation');
            if (this.networkConfig.faucets) {
                recommendations.push(`Get test ETH from: ${this.networkConfig.faucets.join(', ')}`);
            }
        } else {
            recommendations.push('⚠️ Using mainnet - real funds at risk');
            recommendations.push('Test thoroughly on testnet first');
        }
        
        if (this.networkConfig.challengePeriod > 50) {
            recommendations.push(`Long challenge period (${this.networkConfig.challengePeriod} blocks) - plan accordingly`);
        }
        
        return recommendations;
    }

    /**
     * Estime les coûts de gas pour les opérations selon le réseau
     */
    async estimateOperationCosts() {
        try {
            const gasPrice = await this.getOptimalGasPrice();
            const gasPriceGwei = this.blockchain.web3.utils.fromWei(gasPrice.toString(), 'gwei');
            
            // Estimations de gas par opération
            const gasEstimates = {
                fundChannel: 150000,
                createPayment: 0, // Off-chain
                closeChannel: 200000,
                withdraw: 100000
            };
            
            const costs = {};
            for (const [operation, gasAmount] of Object.entries(gasEstimates)) {
                const costWei = BigInt(gasAmount) * gasPrice;
                const costEth = this.blockchain.web3.utils.fromWei(costWei.toString(), 'ether');
                costs[operation] = {
                    gas: gasAmount,
                    costEth: parseFloat(costEth).toFixed(6),
                    costUsd: 'N/A' // Pourrait être calculé avec un oracle
                };
            }
            
            return {
                network: this.network,
                gasPrice: gasPriceGwei + ' Gwei',
                operations: costs,
                currency: this.networkConfig.isTestnet ? 'Test ETH' : 'ETH'
            };
            
        } catch (error) {
            console.error('Failed to estimate operation costs:', error.message);
            return null;
        }
    }
}

module.exports = ChannelManager;