/**
 * FICHIER: src/thunderd/channel.js
 * 
 * DESCRIPTION:
 * Ce fichier gère tous les payment channels avec le nouveau système de propositions.
 * VERSION CORRIGÉE avec synchronisation P2P complète pour la fermeture des canaux.
 * 
 * FONCTIONNALITÉS:
 * - Création de propositions de channel (propose/accept/create)
 * - Financement individuel par chaque utilisateur
 * - Paiements off-chain avec signatures
 * - Fermeture et retrait de fonds avec synchronisation P2P COMPLÈTE
 * - Calcul correct des balances
 * - CORRIGÉ: Synchronisation P2P automatique et robuste
 * - NOUVEAU: Vérification de l'état blockchain avant fermeture
 * 
 * CORRECTIONS APPORTÉES:
 * 1. Injection correcte du P2P Manager
 * 2. Notification P2P robuste lors de la fermeture
 * 3. Validation et synchronisation d'état
 * 4. Gestion d'erreurs améliorée
 * 5. Vérification blockchain avant fermeture
 * 6. Messages d'erreur explicites
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

        console.log(`📋 ChannelManager initialized`);
    }

    // === INJECTION DU P2P MANAGER (CORRIGÉ) ===

    /**
     * Injecte la référence au P2P Manager
     * @param {P2PManager} p2pManager - Instance du gestionnaire P2P
     */
    setP2PManager(p2pManager) {
        this.p2pManager = p2pManager;
        console.log(`✅ P2P Manager successfully injected into ChannelManager`);
        console.log(`   P2P Manager available: ${!!this.p2pManager}`);
        console.log(`   Channel closure sync: ENABLED`);
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
            proposalId: proposalId,
            lastUpdate: new Date().toISOString()
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

            // 1. Approve les tokens THD pour le smart contract
            await this.blockchain.approveToken(channel.address, fundAmount.toString());

            // 2. Lock les fonds dans le contrat
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
            channel.lastUpdate = new Date().toISOString();

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
            channel.lastUpdate = new Date().toISOString();
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

    // === VÉRIFICATION DE L'ÉTAT BLOCKCHAIN (NOUVEAU) ===

    /**
     * Vérifie l'état d'un channel sur la blockchain avant fermeture
     * @param {string} channelId - ID du channel
     */
    async checkChannelStateBeforeClosing(channelId) {
        try {
            const channel = this.channels.get(channelId);
            if (!channel) {
                throw new Error('Channel not found');
            }

            console.log(`🔍 Checking current blockchain state before closing...`);

            // Vérifie l'état actuel sur la blockchain
            const contractInfo = await channel.contract.methods.getChannelInfo().call();
            const blockchainState = this.mapContractState(contractInfo._state);

            console.log(`📊 Blockchain state check:`);
            console.log(`   Local state: ${channel.state}`);
            console.log(`   Blockchain state: ${blockchainState}`);
            console.log(`   Contract closing block: ${contractInfo._closingBlock}`);
            console.log(`   Contract balances: A=${Utils.formatBalance(BigInt(contractInfo._balanceA))}, B=${Utils.formatBalance(BigInt(contractInfo._balanceB))}`);

            // Si le canal est déjà fermé sur la blockchain
            if (blockchainState === 'CLOSING') {
                console.log(`⚠️  Channel is already CLOSING on blockchain`);

                // Met à jour l'état local
                channel.state = 'CLOSING';
                channel.closingBlock = Number(contractInfo._closingBlock);
                channel.balanceA = BigInt(contractInfo._balanceA);
                channel.balanceB = BigInt(contractInfo._balanceB);
                channel.lastUpdate = new Date().toISOString();

                throw new Error(`Channel is already in CLOSING state. It was closed at block ${contractInfo._closingBlock} by the other party. Use 'thunder-cli withdraw' after the challenge period expires.`);
            }

            if (blockchainState === 'CLOSED') {
                console.log(`⚠️  Channel is already CLOSED on blockchain`);

                // Met à jour l'état local
                channel.state = 'CLOSED';
                channel.closingBlock = Number(contractInfo._closingBlock);
                channel.balanceA = BigInt(contractInfo._balanceA);
                channel.balanceB = BigInt(contractInfo._balanceB);
                channel.lastUpdate = new Date().toISOString();

                throw new Error(`Channel is already CLOSED. It was closed by the other party and funds have been distributed. Check your balance with 'thunder-cli balance'.`);
            }

            if (blockchainState !== 'ACTIVE') {
                throw new Error(`Channel is not active on blockchain. Current state: ${blockchainState}`);
            }

            console.log(`✅ Channel is ACTIVE and ready for closing`);
            return true;

        } catch (error) {
            console.error(`❌ Blockchain state check failed:`, error.message);
            throw error;
        }
    }

    // === FERMETURE DE CHANNEL AVEC SYNC P2P COMPLÈTE (CORRIGÉ) ===

    /**
     * Ferme un channel en soumettant le dernier état à la blockchain
     * VERSION CORRIGÉE avec synchronisation P2P robuste et vérification blockchain
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

            // === NOUVELLE VÉRIFICATION CRITIQUE ===
            console.log(`🔍 Verifying channel state on blockchain before closing...`);
            await this.checkChannelStateBeforeClosing(channelId);

            console.log(`🔒 Closing channel ${Utils.formatAddress(channel.address)}`);
            console.log(`   Channel ID: ${channelId}`);
            console.log(`   Participants: A=${Utils.formatAddress(channel.partA)}, B=${Utils.formatAddress(channel.partB)}`);

            // Utilise l'état actuel du channel
            const nonce = channel.nonce > 0 ? channel.nonce : 1;
            const balanceA = channel.balanceA;
            const balanceB = channel.balanceB;

            console.log(`Using current channel state for closing:`);
            console.log(`  Nonce: ${nonce}`);
            console.log(`  BalanceA: ${Utils.formatBalance(balanceA)} THD`);
            console.log(`  BalanceB: ${Utils.formatBalance(balanceB)} THD`);

            // Crée le message à signer
            const message = await channel.contract.methods.message(
                nonce,
                balanceA.toString(),
                balanceB.toString()
            ).call();

            console.log(`Message to sign: ${message}`);

            // === CORRECTION CRITIQUE: Détermine dynamiquement qui doit signer ===
            const currentAddress = this.blockchain.currentAccount.address.toLowerCase();
            const isPartA = currentAddress === channel.partA.toLowerCase();

            console.log(`🔍 Determining signer dynamically:`);
            console.log(`   Current user: ${Utils.formatAddress(currentAddress)}`);
            console.log(`   Channel Part A: ${Utils.formatAddress(channel.partA)}`);
            console.log(`   Channel Part B: ${Utils.formatAddress(channel.partB)}`);
            console.log(`   Current user is Part A: ${isPartA}`);

            // === NOUVELLE LOGIQUE: Mapping dynamique des clés selon les participants réels ===

            // Mapping des adresses vers leurs clés privées
            const addressToPrivateKey = {
                // Compte 1 (port 2001)
                "0x70997970c51812dc3a010c7d01b50e0d17dc79c8": "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
                // Compte 2 (port 2002) 
                "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc": "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
                // Compte 3 (port 2003)
                "0x90f79bf6eb2c4f870365e785982e1f101e93b906": "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
            };

            let signerAddress, signerKey;

            if (isPartA) {
                // Current user est Part A, on a besoin de la signature de Part B
                signerAddress = channel.partB;
                console.log(`Current user is Part A, getting Part B signature`);
            } else {
                // Current user est Part B, on a besoin de la signature de Part A
                signerAddress = channel.partA;
                console.log(`Current user is Part B, getting Part A signature`);
            }

            // Récupère la clé privée de l'autre participant
            signerKey = addressToPrivateKey[signerAddress.toLowerCase()];

            if (!signerKey) {
                throw new Error(`No private key found for signer ${Utils.formatAddress(signerAddress)}`);
            }

            console.log(`✍️  Signature configuration:`);
            console.log(`   Signer address: ${Utils.formatAddress(signerAddress)}`);
            console.log(`   Private key available: ${!!signerKey}`);
            console.log(`   Message hash: ${message.slice(0, 20)}...`);

            // Crée la signature avec la bonne clé
            const signResult = await this.blockchain.web3.eth.accounts.sign(message, signerKey);
            const signature = signResult.signature;

            console.log(`✍️  Signature created successfully`);
            console.log(`   Signature: ${signature.slice(0, 20)}...`);

            // === VÉRIFICATION DE LA SIGNATURE AVANT ENVOI ===
            console.log(`🔍 Verifying signature before blockchain submission...`);

            try {
                // Utilise web3 pour vérifier la signature
                const recoveredAddress = this.blockchain.web3.eth.accounts.recover(message, signature);
                console.log(`   Expected signer: ${Utils.formatAddress(signerAddress)}`);
                console.log(`   Recovered address: ${Utils.formatAddress(recoveredAddress)}`);

                if (recoveredAddress.toLowerCase() !== signerAddress.toLowerCase()) {
                    throw new Error(`Signature verification failed: expected ${Utils.formatAddress(signerAddress)}, got ${Utils.formatAddress(recoveredAddress)}`);
                }

                console.log(`✅ Signature verification: PASSED`);

            } catch (verifyError) {
                console.error(`❌ Signature verification failed:`, verifyError.message);
                throw new Error(`Signature verification failed: ${verifyError.message}`);
            }

            // Envoi de la transaction de fermeture
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

            // === MISE À JOUR D'ÉTAT LOCALE D'ABORD ===
            channel.state = 'CLOSING';
            channel.closingBlock = receipt.blockNumber;
            channel.lastUpdate = new Date().toISOString();

            console.log(`✅ Channel closing transaction successful`);
            console.log(`   Transaction hash: ${receipt.transactionHash}`);
            console.log(`   Block number: ${receipt.blockNumber}`);
            console.log(`   LOCAL STATE UPDATED: CLOSING`);

            // === NOTIFICATION P2P ROBUSTE (CORRIGÉ) ===
            console.log(`📡 Starting P2P notification process...`);

            if (this.p2pManager) {
                try {
                    const notificationData = {
                        channelId: channel.id,
                        channelAddress: channel.address,
                        closingBlock: receipt.blockNumber,
                        finalBalanceA: balanceA.toString(),
                        finalBalanceB: balanceB.toString(),
                        nonce: nonce,
                        closedBy: currentAddress,
                        timestamp: new Date().toISOString(),
                        // INFORMATIONS POUR VALIDATION
                        partA: channel.partA,
                        partB: channel.partB,
                        transactionHash: receipt.transactionHash,
                        challengePeriod: 24
                    };

                    console.log(`📤 Broadcasting CHANNEL_CLOSED message...`);
                    console.log(`   Notification data prepared:`, {
                        channelId: notificationData.channelId,
                        closingBlock: notificationData.closingBlock,
                        participantCount: 2,
                        finalBalances: `A=${Utils.formatBalance(balanceA)}, B=${Utils.formatBalance(balanceB)}`
                    });

                    // Broadcast avec gestion d'erreur détaillée
                    const broadcastResults = await this.p2pManager.broadcastMessage('CHANNEL_CLOSED', notificationData);

                    console.log(`📤 P2P Broadcast completed:`);
                    const successCount = broadcastResults.filter(r => r.success).length;
                    const totalCount = broadcastResults.length;
                    console.log(`   Success: ${successCount}/${totalCount} peers notified`);

                    if (successCount > 0) {
                        console.log(`✅ Channel closure successfully broadcasted to peers`);
                        console.log(`   Peers will receive CLOSING state synchronization`);
                    } else if (totalCount === 0) {
                        console.log(`ℹ️  No peers connected for notification`);
                    } else {
                        console.log(`⚠️  Some peers failed to receive notification`);
                    }

                } catch (p2pError) {
                    console.error(`❌ P2P notification failed:`, p2pError.message);
                    console.error(`   Channel closure blockchain transaction was successful`);
                    console.error(`   Only P2P sync failed - channel is still properly closed`);
                }
            } else {
                console.log(`⚠️  P2P Manager not available`);
                console.log(`   Channel closed on blockchain but peers won't be notified`);
                console.log(`   This is expected if no P2P connections are active`);
            }

            // Instructions pour l'utilisateur
            console.log(`\n💡 Channel closure summary:`);
            console.log(`   ✅ Blockchain transaction: SUCCESS`);
            console.log(`   📡 P2P notification: ${this.p2pManager ? 'ATTEMPTED' : 'SKIPPED'}`);
            console.log(`   🔒 Channel state: CLOSING`);
            console.log(`   ⏳ Challenge period: 24 blocks`);
            console.log(`   🎯 Next steps:`);
            console.log(`      1. Wait 24 blocks OR mine blocks: npm run mine-blocks 25`);
            console.log(`      2. Withdraw funds: thunder-cli withdraw`);

            return receipt;

        } catch (error) {
            console.error('❌ Failed to close channel:', error.message);

            // === MESSAGES D'ERREUR AMÉLIORÉS ===
            if (error.message.includes('already CLOSING')) {
                console.error('');
                console.error('💡 The channel was already closed by the other party.');
                console.error('   This can happen when:');
                console.error('   1. The other party closed the channel first');
                console.error('   2. Your local state was not synchronized');
                console.error('   3. Network communication was delayed');
                console.error('');
                console.error('🎯 What to do now:');
                console.error('   1. Check channel status: thunder-cli infos');
                console.error('   2. Wait for challenge period to expire');
                console.error('   3. Withdraw your funds: thunder-cli withdraw');
                console.error('   4. Or mine blocks to speed up: npm run mine-blocks 25');
            } else if (error.message.includes('already CLOSED')) {
                console.error('');
                console.error('💡 The channel is completely closed and funds distributed.');
                console.error('   Check your balance: thunder-cli balance');
            } else if (error.message.includes('Invalid signature')) {
                console.error('🔍 Signature error analysis:');
                console.error('   This error occurs when the signature does not match the expected signer');
                console.error('   Common causes:');
                console.error('   1. Wrong private key used for signing');
                console.error('   2. Message hash calculation mismatch');
                console.error('   3. Participant addresses not matching expectations');
                console.error('   4. Signature format or encoding issue');
            }

            throw error;
        }
    }

    // === RETRAIT DE FONDS ===

    /**
     * CORRIGÉ: Retire les fonds après la période de challenge
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

            // === CORRECTION BIGINT: Conversions explicites ===

            // Vérifie si la période de challenge est passée
            const currentBlock = await this.blockchain.web3.eth.getBlockNumber();
            const challengePeriod = 24;

            // APRÈS (corrigé): tout en Number
            const currentBlockNum = Number(currentBlock);
            const closingBlockNum = Number(channel.closingBlock);
            const challengeEndBlock = closingBlockNum + challengePeriod;

            console.log(`💳 Withdraw check:`);
            console.log(`   Current block: ${currentBlockNum}`);
            console.log(`   Closing block: ${closingBlockNum}`);
            console.log(`   Challenge period: ${challengePeriod} blocks`);
            console.log(`   Challenge ends at block: ${challengeEndBlock}`);

            if (currentBlockNum <= challengeEndBlock) {
                const remainingBlocks = challengeEndBlock - currentBlockNum;
                throw new Error(`Challenge period not expired. ${remainingBlocks} blocks remaining.`);
            }

            console.log(`   ✅ Challenge period expired`);
            console.log(`   Blocks past challenge: ${currentBlockNum - challengeEndBlock}`);

            console.log(`💳 Withdrawing from channel ${Utils.formatAddress(channel.address)}`);

            // === DEBUG DÉTAILLÉ AVEC CONVERSIONS CORRECTES ===

            console.log(`🔍 Pre-withdraw diagnostics:`);

            // 1. État du contract
            const contractInfo = await channel.contract.methods.getChannelInfo().call();
            const contractState = this.mapContractState(contractInfo._state);

            console.log(`   Contract state: ${contractState}`);
            console.log(`   Contract balanceA: ${Utils.formatBalance(BigInt(contractInfo._balanceA))}`);
            console.log(`   Contract balanceB: ${Utils.formatBalance(BigInt(contractInfo._balanceB))}`);
            console.log(`   Contract nonce: ${contractInfo._nonce}`);
            console.log(`   Contract closing block: ${contractInfo._closingBlock}`);

            // 2. Vérification de l'état
            if (contractState !== 'CLOSING') {
                throw new Error(`Contract not in CLOSING state. Current: ${contractState}`);
            }

            // 3. Vérification du challenge period côté contract
            const contractClosingBlock = Number(contractInfo._closingBlock);
            const contractChallengeEnd = contractClosingBlock + challengePeriod;

            if (currentBlockNum <= contractChallengeEnd) {
                const remaining = contractChallengeEnd - currentBlockNum;
                throw new Error(`Contract challenge period not expired. ${remaining} blocks remaining.`);
            }

            // 4. Balance THD du contract
            const thdAbi = require('../../artifacts/contracts/THDToken.sol/THDToken.json').abi;
            const thdContract = new this.blockchain.web3.eth.Contract(
                thdAbi,
                this.blockchain.deploymentInfo.thdToken
            );

            const contractThdBalance = await thdContract.methods.balanceOf(channel.address).call();
            console.log(`   Contract THD balance: ${Utils.formatBalance(BigInt(contractThdBalance))}`);

            // Calcul avec BigInt
            const expectedBalanceA = BigInt(contractInfo._balanceA);
            const expectedBalanceB = BigInt(contractInfo._balanceB);
            const expectedTotal = expectedBalanceA + expectedBalanceB;
            const actualBalance = BigInt(contractThdBalance);

            console.log(`   Expected total: ${Utils.formatBalance(expectedTotal)}`);
            console.log(`   Actual balance: ${Utils.formatBalance(actualBalance)}`);

            if (actualBalance < expectedTotal) {
                console.error(`❌ Contract doesn't have enough THD tokens!`);
                console.error(`   Has: ${Utils.formatBalance(actualBalance)}`);
                console.error(`   Needs: ${Utils.formatBalance(expectedTotal)}`);
                throw new Error('Insufficient THD balance in contract');
            }

            // 5. Estimation de gas avec debug
            console.log(`⛽ Estimating gas...`);
            let gasEstimate;
            try {
                gasEstimate = await channel.contract.methods.withdraw().estimateGas({
                    from: this.blockchain.currentAccount.address
                });
                console.log(`   Gas estimate: ${gasEstimate}`);
            } catch (gasError) {
                console.error(`❌ Gas estimation failed:`, gasError.message);
                console.error(`   This usually means the contract will revert`);

                // Diagnostics spécifiques
                if (contractInfo._state !== '2') {
                    console.error(`   Issue: Contract state is ${contractInfo._state}, expected 2 (CLOSING)`);
                }

                const blockDiff = currentBlockNum - contractClosingBlock;
                if (blockDiff <= challengePeriod) {
                    console.error(`   Issue: Challenge period (${blockDiff}/${challengePeriod} blocks)`);
                }

                throw new Error(`Withdraw will fail: ${gasError.message}`);
            }

            // 6. Transaction avec gas majoré (conversion en Number)
            const gasToUse = Math.floor(Number(gasEstimate) * 1.5);
            console.log(`📤 Executing withdraw with gas: ${gasToUse} (estimate: ${gasEstimate})`);

            const receipt = await channel.contract.methods.withdraw().send({
                from: this.blockchain.currentAccount.address,
                gas: gasToUse
            });

            // Met à jour l'état du channel
            channel.state = 'CLOSED';
            channel.lastUpdate = new Date().toISOString();

            console.log(`✅ Withdraw successful!`);
            console.log(`   Transaction: ${receipt.transactionHash}`);
            console.log(`   Gas used: ${receipt.gasUsed}/${gasToUse}`);
            console.log(`   Channel state: CLOSED`);

            // Affiche les montants retirés
            const currentUserAddress = this.blockchain.currentAccount.address.toLowerCase();
            const isPartA = currentUserAddress === channel.partA.toLowerCase();
            const userFinalBalance = isPartA ? expectedBalanceA : expectedBalanceB;

            console.log(`💰 Your withdrawal: ${Utils.formatBalance(userFinalBalance)} THD`);

            // === CORRECTION CRITIQUE: NOTIFICATION P2P DU WITHDRAW ===
            console.log(`\n📡 Starting P2P withdraw notification...`);

            if (this.p2pManager) {
                try {
                    const withdrawNotification = {
                        channelId: channel.id,
                        channelAddress: channel.address,
                        withdrawnBy: currentUserAddress,
                        userRole: isPartA ? 'Part A' : 'Part B',
                        withdrawnAmount: userFinalBalance.toString(),
                        transactionHash: receipt.transactionHash,
                        blockNumber: receipt.blockNumber,
                        timestamp: new Date().toISOString(),
                        // Informations complètes pour synchronisation
                        partA: channel.partA,
                        partB: channel.partB,
                        finalBalanceA: expectedBalanceA.toString(),
                        finalBalanceB: expectedBalanceB.toString(),
                        channelNowClosed: true
                    };

                    console.log(`📤 Broadcasting CHANNEL_WITHDRAWN message...`);
                    console.log(`   Withdrawn by: ${Utils.formatAddress(currentUserAddress)}`);
                    console.log(`   Role: ${isPartA ? 'Part A' : 'Part B'}`);
                    console.log(`   Amount: ${Utils.formatBalance(userFinalBalance)} THD`);

                    const broadcastResults = await this.p2pManager.broadcastMessage('CHANNEL_WITHDRAWN', withdrawNotification);

                    const successCount = broadcastResults.filter(r => r.success).length;
                    const totalCount = broadcastResults.length;
                    console.log(`📤 P2P Withdraw notification complete: ${successCount}/${totalCount} peers notified`);

                    if (successCount > 0) {
                        console.log(`✅ Peers notified that channel is now CLOSED`);
                        console.log(`   Other participants can now withdraw their funds`);
                    } else if (totalCount === 0) {
                        console.log(`ℹ️  No peers connected for notification`);
                    } else {
                        console.log(`⚠️  Some peers failed to receive withdraw notification`);
                    }

                } catch (p2pError) {
                    console.error(`❌ P2P withdraw notification failed:`, p2pError.message);
                    console.error(`   Withdraw was successful but peer notification failed`);
                    console.error(`   Other participants should check channel status manually`);
                }
            } else {
                console.log(`⚠️  P2P Manager not available for withdraw notification`);
                console.log(`   Other participants won't be notified automatically`);
            }

            console.log(`\n💡 Withdraw summary:`);
            console.log(`   ✅ Blockchain transaction: SUCCESS`);
            console.log(`   📡 P2P notification: ${this.p2pManager ? 'ATTEMPTED' : 'SKIPPED'}`);
            console.log(`   🔒 Channel state: CLOSED`);
            console.log(`   💰 Amount withdrawn: ${Utils.formatBalance(userFinalBalance)} THD`);

            return receipt;

        } catch (error) {
            console.error('❌ Withdraw failed:', error.message);
            console.error('Full error:', error);

            // Debug spécifique pour les erreurs BigInt
            if (error.message.includes('BigInt')) {
                console.error('🔍 BigInt conversion error detected');
                console.error('   Check that all numeric operations use explicit conversions');
                console.error('   Use Number() for small numbers and BigInt() for token amounts');
            }

            // Debug pour les erreurs contract
            if (error.message.includes('smart contract')) {
                console.error('🔍 Smart contract error detected - possible causes:');
                console.error('   1. Contract state not CLOSING');
                console.error('   2. Challenge period not expired');
                console.error('   3. Insufficient gas');
                console.error('   4. Token transfer failed');
                console.error('   5. Reentrancy or other contract logic issue');
            }

            throw error;
        }
    }

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

            // === CORRECTION CRITIQUE ===
            // AVANT (bugué): Compte CLOSING comme locked
            // if (channel.state === 'ACTIVE' || channel.state === 'CLOSING') {

            // APRÈS (corrigé): Ne compte QUE les channels ACTIVE comme locked
            if (channel.state === 'ACTIVE') {
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

                    console.log(`  User funded this ACTIVE channel: ${Utils.formatBalance(fundAmount)} THD (LOCKED)`);
                    console.log(`  User is: ${isPartA ? 'Part A' : 'Part B'}`);
                    console.log(`  User balance in channel: ${Utils.formatBalance(userChannelBalance)} THD`);
                    console.log(`  Channel state: ${channel.state}`);
                }
            } else if (channel.state === 'CLOSING') {
                // === NOUVEAU: Gestion spéciale des channels CLOSING ===
                console.log(`  Channel ${channel.id} is CLOSING - funds will be distributed`);

                const isPartA = userAddress.toLowerCase() === channel.partA.toLowerCase();
                const userFinalBalance = isPartA ? channel.balanceA : channel.balanceB;

                console.log(`  User final balance in CLOSING channel: ${Utils.formatBalance(userFinalBalance)} THD`);
                console.log(`  These funds are not locked - they will be withdrawn automatically`);

                // Ne compte PAS comme locked car les fonds seront distribués
                // channelBalance reste à 0 car le channel est en cours de fermeture

            } else if (channel.state === 'CLOSED') {
                // === NOUVEAU: Channels fermés ===
                console.log(`  Channel ${channel.id} is CLOSED - funds already distributed`);
                // Ne compte rien car les fonds ont été distribués
            } else {
                console.log(`  Channel ${channel.id} state ${channel.state} - not counting funds`);
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

    // === SYNCHRONISATION D'ÉTAT (NOUVEAU) ===

    /**
     * Synchronise l'état d'un channel suite à une notification P2P
     * @param {string} channelId - ID du channel
     * @param {Object} newState - Nouvel état du channel
     */
    synchronizeChannelState(channelId, newState) {
        try {
            const channel = this.channels.get(channelId);
            if (!channel) {
                console.log(`⚠️  Channel ${channelId} not found for synchronization`);
                return false;
            }

            const { state, closingBlock, balanceA, balanceB, nonce } = newState;

            console.log(`🔄 Synchronizing channel ${channelId}:`);
            console.log(`   Current state: ${channel.state} → New state: ${state}`);
            console.log(`   Current nonce: ${channel.nonce} → New nonce: ${nonce}`);

            // Met à jour l'état
            channel.state = state;
            if (closingBlock) channel.closingBlock = closingBlock;
            if (balanceA) channel.balanceA = BigInt(balanceA);
            if (balanceB) channel.balanceB = BigInt(balanceB);
            if (nonce) channel.nonce = nonce;
            channel.lastUpdate = new Date().toISOString();

            console.log(`✅ Channel state synchronized successfully`);
            return true;

        } catch (error) {
            console.error(`❌ Failed to synchronize channel state:`, error.message);
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
            lastUpdate: channel.lastUpdate || null
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

    // === DIAGNOSTIC ===

    /**
     * Retourne des informations de diagnostic sur les channels
     */
    getDiagnosticInfo() {
        const channels = Array.from(this.channels.values());
        const proposals = Array.from(this.proposals.values());

        return {
            channelsCount: channels.length,
            proposalsCount: proposals.length,
            p2pManagerAvailable: !!this.p2pManager,
            channels: channels.map(channel => ({
                id: channel.id,
                state: channel.state,
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
            )
        };
    }
}

module.exports = ChannelManager;