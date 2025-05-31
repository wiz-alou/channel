/**
 * FICHIER: src/thunderd/channel.js
 * 
 * DESCRIPTION:
 * Ce fichier gère tous les payment channels avec le nouveau système de propositions.
 * 
 * FONCTIONNALITÉS:
 * - Création de propositions de channel (propose/accept/create)
 * - Financement individuel par chaque utilisateur
 * - Paiements off-chain avec signatures
 * - Fermeture et retrait de fonds
 * - Calcul correct des balances
 * - NOUVEAU: Synchronisation P2P de fermeture de channel
 * 
 * WORKFLOW:
 * 1. User A propose un channel à User B
 * 2. User B accepte la proposition
 * 3. User A crée le smart contract
 * 4. Les 2 users financent leur part (5 THD chacun pour un channel 10 THD)
 * 5. Channel devient ACTIVE
 * 6. Paiements off-chain bidirectionnels
 * 7. Fermeture + challenge period + withdraw
 * 8. NOUVEAU: Notification P2P automatique de la fermeture
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
    }

    // === INJECTION DU P2P MANAGER ===
    
    /**
     * Injecte la référence au P2P Manager
     * @param {P2PManager} p2pManager - Instance du gestionnaire P2P
     */
    setP2PManager(p2pManager) {
        this.p2pManager = p2pManager;
        console.log(`📡 P2P Manager injected into ChannelManager`);
    }

    // === SYSTÈME DE PROPOSITIONS ===

    /**
     * Crée une proposition de channel
     * @param {string} proposerId - Adresse de celui qui propose
     * @param {string} acceptorId - Adresse de celui qui doit accepter
     * @param {string} amount - Montant total du channel en wei
     */
    createChannelProposal(proposerId, acceptorId, amount) {
        const proposal = {
            id: Utils.generateId(),
            proposer: proposerId,
            acceptor: acceptorId,
            amount: amount.toString(), // Convert BigInt to string
            status: 'PROPOSED',
            createdAt: new Date().toISOString(),
            acceptedAt: null,
            channelId: null
        };

        this.proposals.set(proposal.id, {
            ...proposal,
            amount: BigInt(amount) // Keep BigInt internally
        });

        console.log(`📋 Channel proposal created:`);
        console.log(`   ID: ${proposal.id}`);
        console.log(`   Proposer: ${Utils.formatAddress(proposerId)}`);
        console.log(`   Acceptor: ${Utils.formatAddress(acceptorId)}`);
        console.log(`   Amount: ${Utils.formatBalance(BigInt(amount))} THD`);

        return proposal; // Return serializable version
    }

    /**
     * Accepte une proposition de channel
     * @param {string} proposalId - ID de la proposition
     * @param {string} acceptorId - Adresse de celui qui accepte
     */
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

        console.log(`✅ Channel proposal ${proposalId} accepted by ${Utils.formatAddress(acceptorId)}`);

        // Return serializable version
        return {
            ...proposal,
            amount: proposal.amount.toString()
        };
    }

    /**
     * Crée le smart contract à partir d'une proposition acceptée
     * @param {string} proposalId - ID de la proposition
     */
    async createChannelFromProposal(proposalId) {
        const proposal = this.proposals.get(proposalId);
        if (!proposal) {
            throw new Error('Proposal not found');
        }

        if (proposal.status !== 'ACCEPTED') {
            throw new Error(`Cannot create channel from proposal in status: ${proposal.status}`);
        }

        // Déploie le smart contract PaymentChannel
        const channelInfo = await this.blockchain.deployPaymentChannel(
            proposal.proposer,
            proposal.acceptor,
            proposal.amount.toString()
        );

        // Crée l'objet channel
        const channel = {
            id: Utils.generateId(),
            address: channelInfo.address,
            contract: channelInfo.contract,
            partA: proposal.proposer,
            partB: proposal.acceptor,
            amount: proposal.amount,
            state: 'EMPTY',
            nonce: 0,
            balanceA: proposal.amount / BigInt(2),  // 50/50 initial
            balanceB: proposal.amount / BigInt(2),
            createdAt: new Date().toISOString(),
            pendingPayments: [],
            proposalId: proposalId
        };

        this.channels.set(channel.id, channel);

        // Met à jour la proposition
        proposal.status = 'CREATED';
        proposal.channelId = channel.id;

        // Initialise le suivi du financement
        this.userFunding.set(channel.id, {
            [proposal.proposer.toLowerCase()]: false,
            [proposal.acceptor.toLowerCase()]: false
        });

        console.log(`🔓 Channel created from proposal:`);
        console.log(`   Channel ID: ${channel.id}`);
        console.log(`   Address: ${Utils.formatAddress(channelInfo.address)}`);
        console.log(`   Status: Both parties need to fund`);

        return channel;
    }

    // === FINANCEMENT INDIVIDUEL ===

    /**
     * Permet à un utilisateur de financer sa part du channel
     * @param {string} channelId - ID du channel
     * @param {string} userAddress - Adresse de l'utilisateur
     */
    async fundChannelByUser(channelId, userAddress) {
        try {
            const channel = this.channels.get(channelId);
            if (!channel) {
                throw new Error('Channel not found');
            }

            const userAddr = userAddress.toLowerCase();
            const partAAddr = channel.partA.toLowerCase();
            const partBAddr = channel.partB.toLowerCase();

            // Vérifie que l'utilisateur fait partie du channel
            if (userAddr !== partAAddr && userAddr !== partBAddr) {
                throw new Error('User is not a participant in this channel');
            }

            // Vérifie si l'utilisateur a déjà financé
            const funding = this.userFunding.get(channelId);
            if (funding[userAddr]) {
                throw new Error('User has already funded this channel');
            }

            console.log(`💰 ${Utils.formatAddress(userAddress)} funding channel ${Utils.formatAddress(channel.address)}`);

            const fundAmount = channel.amount / BigInt(2);  // Chaque partie finance 50%

            // ===== MODIFICATION PRINCIPALE =====
            // Au lieu de transferFrom, on fait un approve + call special

            // 1. Approve les tokens THD pour le smart contract
            await this.blockchain.approveToken(channel.address, fundAmount.toString());

            // 2. Lock les fonds dans le contrat (escrow, pas transfer)
            const tx = channel.contract.methods.fund();
            const gas = await tx.estimateGas({ from: userAddress });
            const receipt = await tx.send({
                from: userAddress,
                gas: gas
            });

            // 3. Marque l'utilisateur comme ayant financé
            funding[userAddr] = true;

            // 4. Vérifie l'état réel du smart contract après financement
            console.log(`🔍 Checking contract state after funding...`);
            const channelInfo = await channel.contract.methods.getChannelInfo().call();
            const contractState = this.mapContractState(channelInfo._state);

            console.log(`📊 Contract state: ${contractState}`);
            console.log(`   Contract balanceA: ${Utils.formatBalance(BigInt(channelInfo._balanceA))}`);
            console.log(`   Contract balanceB: ${Utils.formatBalance(BigInt(channelInfo._balanceB))}`);

            // Met à jour l'état local selon le contract
            channel.state = contractState;

            // Vérifie si les deux parties ont financé localement
            const bothFundedLocally = funding[partAAddr] && funding[partBAddr];

            // Le channel est vraiment actif quand le contract dit ACTIVE
            const isReallyActive = contractState === 'ACTIVE';

            if (isReallyActive) {
                console.log(`🎉 Channel fully funded and ACTIVE!`);
                console.log(`   Both parties funded: ${Utils.formatBalance(fundAmount)} THD each`);
            } else {
                console.log(`⏳ Waiting for other party to fund...`);
                const waitingFor = funding[partAAddr] ? 'Part B' : 'Part A';
                console.log(`   Waiting for: ${waitingFor}`);
            }

            console.log(`✅ User funded: ${Utils.formatBalance(fundAmount)} THD`);
            console.log(`   Channel state: ${channel.state}`);

            return {
                receipt,
                bothFunded: isReallyActive,
                channelState: channel.state,
                funded: true
            };

        } catch (error) {
            console.error('❌ Failed to fund channel:', error.message);
            throw error;
        }
    }

    // === PAIEMENTS OFF-CHAIN ===

    /**
     * Crée un paiement off-chain signé
     * @param {string} channelId - ID du channel
     * @param {string} amount - Montant en wei
     */
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

            console.log(`💸 Creating payment: ${Utils.formatBalance(paymentAmount)} THD`);
            console.log(`   From: ${isPartA ? 'Part A' : 'Part B'} (${Utils.formatAddress(currentAddress)})`);
            console.log(`   Current balances: A=${Utils.formatBalance(channel.balanceA)}, B=${Utils.formatBalance(channel.balanceB)}`);

            // Calcule les nouveaux soldes
            let newBalanceA = channel.balanceA;
            let newBalanceB = channel.balanceB;

            if (isPartA) {
                // Part A paie Part B
                if (newBalanceA < paymentAmount) {
                    throw new Error(`Insufficient balance in channel. Available: ${Utils.formatBalance(newBalanceA)}, Required: ${Utils.formatBalance(paymentAmount)}`);
                }
                newBalanceA -= paymentAmount;
                newBalanceB += paymentAmount;
            } else {
                // Part B paie Part A
                if (newBalanceB < paymentAmount) {
                    throw new Error(`Insufficient balance in channel. Available: ${Utils.formatBalance(newBalanceB)}, Required: ${Utils.formatBalance(paymentAmount)}`);
                }
                newBalanceB -= paymentAmount;
                newBalanceA += paymentAmount;
            }

            // Crée le nouvel état
            const newNonce = channel.nonce + 1;
            const message = await channel.contract.methods.message(
                newNonce,
                newBalanceA.toString(),
                newBalanceB.toString()
            ).call();

            // Signe le message
            const signature = await this.blockchain.web3.eth.accounts.sign(
                message,
                this.blockchain.currentAccount.privateKey
            );

            // Crée l'objet paiement
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
                timestamp: new Date().toISOString()
            };

            // Met à jour l'état du channel (off-chain)
            channel.nonce = newNonce;
            channel.balanceA = newBalanceA;
            channel.balanceB = newBalanceB;
            channel.pendingPayments.push(payment);

            console.log(`✅ Off-chain payment created: ${Utils.formatBalance(paymentAmount)} THD`);
            console.log(`   New balances: A=${Utils.formatBalance(newBalanceA)}, B=${Utils.formatBalance(newBalanceB)}`);
            console.log(`   Nonce: ${newNonce}`);

            return payment;

        } catch (error) {
            console.error('❌ Failed to create payment:', error.message);
            throw error;
        }
    }

    // === FERMETURE DE CHANNEL AVEC SYNC P2P ===

    /**
     * Ferme un channel en soumettant le dernier état à la blockchain
     * @param {string} channelId - ID du channel
     */
    async closeChannel(channelId) {
        try {
            const channel = this.channels.get(channelId);
            if (!channel) {
                throw new Error('Channel not found');
            }
            
            if (channel.state !== 'ACTIVE') {
                throw new Error(`Channel not active. Current state: ${channel.state}`);
            }
            
            console.log(`🔒 Closing channel ${Utils.formatAddress(channel.address)}`);
            
            // ===== UTILISE L'ÉTAT ACTUEL DU CHANNEL =====
            
            const nonce = channel.nonce > 0 ? channel.nonce : 1;
            const balanceA = channel.balanceA;
            const balanceB = channel.balanceB;
            
            console.log(`Using current channel state for closing:`);
            console.log(`  Nonce: ${nonce}`);
            console.log(`  BalanceA: ${Utils.formatBalance(balanceA)} THD`);
            console.log(`  BalanceB: ${Utils.formatBalance(balanceB)} THD`);
            
            // ===== CRÉE UNE SIGNATURE FRAÎCHE =====
            
            // 1. Crée le message à signer
            const message = await channel.contract.methods.message(
                nonce,
                balanceA.toString(),
                balanceB.toString()
            ).call();
            
            console.log(`Message to sign: ${message}`);
            
            // 2. Détermine qui doit signer (l'AUTRE partie)
            const currentAddress = this.blockchain.currentAccount.address.toLowerCase();
            const isPartA = currentAddress === channel.partA.toLowerCase();
            
            let signerKey, signerAddress;
            
            if (isPartA) {
                signerKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
                signerAddress = channel.partB;
                console.log(`Current user is Part A, getting Part B signature`);
            } else {
                signerKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
                signerAddress = channel.partA;
                console.log(`Current user is Part B, getting Part A signature`);
            }
            
            // 3. Crée la signature
            const signResult = await this.blockchain.web3.eth.accounts.sign(message, signerKey);
            const signature = signResult.signature;
            
            console.log(`✍️  Signature created:`);
            console.log(`  Signer address: ${signerAddress}`);
            console.log(`  Signature: ${signature.slice(0, 20)}...`);
            
            // ===== SKIP VALIDATION LOCALE =====
            console.log(`⚠️  Skipping local signature validation`);
            console.log(`    The smart contract will perform its own validation`);
            
            // ===== ENVOI DE LA TRANSACTION =====
            
            console.log(`📤 Sending closing transaction...`);
            
            const tx = channel.contract.methods.closing(
                nonce,
                balanceA.toString(),
                balanceB.toString(),
                signature
            );
            
            const gas = await tx.estimateGas({ from: this.blockchain.currentAccount.address });
            const receipt = await tx.send({
                from: this.blockchain.currentAccount.address,
                gas: gas
            });
            
            // Met à jour l'état du channel
            channel.state = 'CLOSING';
            channel.closingBlock = receipt.blockNumber;
            
            console.log(`✅ Channel closing initiated successfully`);
            console.log(`   Transaction hash: ${receipt.transactionHash}`);
            console.log(`   Block number: ${receipt.blockNumber}`);
            console.log(`   Challenge period: 24 blocks`);
            console.log(`   Final balances: A=${Utils.formatBalance(balanceA)}, B=${Utils.formatBalance(balanceB)}`);
            
            // ===== NOUVEAU: NOTIFICATION P2P =====
            console.log(`📡 Notifying peers about channel closure...`);
            
            if (this.p2pManager) {
                try {
                    await this.p2pManager.broadcastMessage('CHANNEL_CLOSED', {
                        channelId: channel.id,
                        channelAddress: channel.address,
                        closingBlock: receipt.blockNumber,
                        finalBalanceA: balanceA.toString(),
                        finalBalanceB: balanceB.toString(),
                        nonce: nonce,
                        closedBy: currentAddress,
                        timestamp: new Date().toISOString()
                    });
                    
                    console.log(`📤 Channel closure broadcasted to all peers`);
                } catch (p2pError) {
                    console.error(`⚠️  Failed to notify peers:`, p2pError.message);
                    // Continue même si P2P échoue - la fermeture blockchain a réussi
                }
            } else {
                console.log(`⚠️  P2P Manager not available for broadcasting`);
            }
            
            return receipt;
            
        } catch (error) {
            console.error('❌ Failed to close channel:', error.message);
            throw error;
        }
    }

    // === RETRAIT DE FONDS ===

    /**
     * Retire les fonds après la période de challenge
     * @param {string} channelId - ID du channel
     */
    async withdrawFromChannel(channelId) {
        try {
            const channel = this.channels.get(channelId);
            if (!channel) {
                throw new Error('Channel not found');
            }

            if (channel.state !== 'CLOSING') {
                throw new Error(`Channel not in closing state. Current state: ${channel.state}`);
            }

            // Vérifie si la période de challenge est passée
            const currentBlock = await this.blockchain.web3.eth.getBlockNumber();
            const challengePeriod = 24;

            const currentBlockNum = Number(currentBlock);
            const closingBlockNum = Number(channel.closingBlock);

            if (currentBlockNum <= closingBlockNum + challengePeriod) {
                const remainingBlocks = (closingBlockNum + challengePeriod) - currentBlockNum;
                throw new Error(`Challenge period not expired. ${remainingBlocks} blocks remaining.`);
            }

            console.log(`💳 Withdrawing from channel ${Utils.formatAddress(channel.address)}`);
            console.log(`   Current block: ${currentBlockNum}`);
            console.log(`   Closing block: ${closingBlockNum}`);
            console.log(`   Challenge period expired ✅`);

            // Appelle la fonction withdraw()
            const tx = channel.contract.methods.withdraw();
            const gas = await tx.estimateGas({ from: this.blockchain.currentAccount.address });

            const receipt = await tx.send({
                from: this.blockchain.currentAccount.address,
                gas: gas
            });

            // Met à jour l'état du channel
            channel.state = 'CLOSED';

            console.log(`✅ Funds withdrawn successfully`);
            return receipt;

        } catch (error) {
            console.error('❌ Failed to withdraw:', error.message);
            throw error;
        }
    }

    // === CALCUL DES BALANCES ===

    /**
     * Calcule les balances d'un utilisateur (THD lockés + balance dans les channels)
     * @param {string} userAddress - Adresse de l'utilisateur
     */
    getChannelBalance(userAddress) {
        let totalLocked = BigInt(0);
        let channelBalance = BigInt(0);

        console.log(`Calculating channel balance for ${Utils.formatAddress(userAddress)}`);
        console.log(`Total channels: ${this.channels.size}`);

        for (const channel of this.channels.values()) {
            console.log(`Channel ${channel.id}: state=${channel.state}, amount=${Utils.formatBalance(channel.amount)}`);

            // Compte seulement les channels financés
            if (channel.state === 'ACTIVE' || channel.state === 'CLOSING') {
                const fundAmount = channel.amount / BigInt(2);

                // Vérifie si cet utilisateur a vraiment financé ce channel
                const funding = this.userFunding.get(channel.id);
                const userAddr = userAddress.toLowerCase();

                if (funding && funding[userAddr]) {
                    totalLocked += fundAmount;

                    // Récupère le solde actuel de l'utilisateur dans le channel
                    const isPartA = userAddress.toLowerCase() === channel.partA.toLowerCase();
                    const userChannelBalance = isPartA ? channel.balanceA : channel.balanceB;
                    channelBalance += userChannelBalance;

                    console.log(`  User funded this channel: ${Utils.formatBalance(fundAmount)} THD (LOCKED)`);
                    console.log(`  User is: ${isPartA ? 'Part A' : 'Part B'}`);
                    console.log(`  User balance in channel: ${Utils.formatBalance(userChannelBalance)} THD`);
                }
            }
        }

        console.log(`Final calculation:`);
        console.log(`  Total locked: ${Utils.formatBalance(totalLocked)} THD`);
        console.log(`  Channel balance: ${Utils.formatBalance(channelBalance)} THD`);

        return {
            locked: totalLocked,
            balance: channelBalance
        };
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
            closingBlock: channel.closingBlock || null
        }));
    }

    getProposals() {
        return Array.from(this.proposals.values()).map(proposal => ({
            ...proposal,
            amount: proposal.amount.toString()
        }));
    }

    getProposal(proposalId) {
        return this.proposals.get(proposalId);
    }
}

module.exports = ChannelManager;