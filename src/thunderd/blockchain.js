const { Web3 } = require('web3');
const Utils = require('../shared/utils');

class BlockchainManager {
    constructor(rpcUrl = null, network = 'localhost') {
        // Auto-détection du réseau et RPC
        this.network = network;
        this.rpcUrl = this.determineRpcUrl(rpcUrl, network);
        
        console.log(`🌐 Initializing blockchain connection:`);
        console.log(`   Network: ${this.network}`);
        console.log(`   RPC: ${this.rpcUrl}`);
        
        this.web3 = new Web3(this.rpcUrl);
        this.deploymentInfo = null;
        this.thdContract = null;
        this.currentAccount = null;
    }
    
    /**
     * Détermine l'URL RPC selon le réseau
     */
    determineRpcUrl(providedUrl, network) {
        if (providedUrl) {
            return providedUrl;
        }
        
        // URLs par défaut selon le réseau
        const defaultRpcs = {
            'localhost': 'http://127.0.0.1:8545',
            'sepolia': process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
            'mainnet': process.env.MAINNET_RPC_URL || 'https://cloudflare-eth.com'
        };
        
        return defaultRpcs[network] || defaultRpcs['localhost'];
    }
    
    async initialize() {
        try {
            console.log(`🔗 Connecting to blockchain...`);
            
            // Test de connexion
            const isConnected = await this.web3.eth.net.isListening();
            if (!isConnected) {
                throw new Error('Cannot connect to blockchain');
            }
            
            // Récupère les informations du réseau
            const chainId = await this.web3.eth.getChainId();
            const blockNumber = await this.web3.eth.getBlockNumber();
            
            console.log(`   Chain ID: ${chainId}`);
            console.log(`   Block number: ${blockNumber}`);
            
            // Détecte automatiquement le réseau
            this.network = this.detectNetworkFromChainId(Number(chainId));
            console.log(`   Detected network: ${this.network}`);
            
            // Charge les informations de déploiement
            try {
                this.deploymentInfo = Utils.loadDeploymentInfo(this.network);
                console.log(`   Deployment loaded: ${this.network}.json`);
            } catch (error) {
                console.log(`   ⚠️  No deployment found for ${this.network}`);
                
                // Pour Sepolia, donne des instructions
                if (this.network === 'sepolia') {
                    console.log(`   💡 Pour déployer sur Sepolia:`);
                    console.log(`      1. Configurer .env avec SEPOLIA_RPC_URL et PRIVATE_KEY`);
                    console.log(`      2. npx hardhat run scripts/deploy-sepolia.js --network sepolia`);
                }
                
                this.deploymentInfo = null;
            }
            
            // Configure le contrat THD si disponible
            if (this.deploymentInfo && this.deploymentInfo.thdToken) {
                try {
                    const thdAbi = require('../../artifacts/contracts/THDToken.sol/THDToken.json').abi;
                    this.thdContract = new this.web3.eth.Contract(thdAbi, this.deploymentInfo.thdToken);
                    console.log(`   THD Contract: ${this.deploymentInfo.thdToken}`);
                } catch (error) {
                    console.log(`   ⚠️  Failed to load THD contract: ${error.message}`);
                }
            }
            
            console.log('✅ Blockchain connected successfully');
            
            // Affiche le résumé
            this.displayNetworkSummary();
            
            return true;
        } catch (error) {
            console.error('❌ Blockchain initialization failed:', error.message);
            
            // Messages d'aide spécifiques
            if (error.message.includes('connect')) {
                console.error('💡 Vérifiez:');
                console.error('   - URL RPC correcte');
                console.error('   - Connexion internet');
                if (this.network === 'localhost') {
                    console.error('   - Hardhat node en cours: npm run node');
                }
            }
            
            throw error;
        }
    }
    
    /**
     * Détecte le réseau à partir du Chain ID
     */
    detectNetworkFromChainId(chainId) {
        const networks = {
            1: 'mainnet',
            11155111: 'sepolia',
            31337: 'localhost',
            1337: 'localhost'
        };
        
        return networks[chainId] || 'unknown';
    }
    
    /**
     * Affiche un résumé du réseau connecté
     */
    displayNetworkSummary() {
        console.log(`\n📊 Network Summary:`);
        console.log(`   🌐 Network: ${this.network.toUpperCase()}`);
        console.log(`   🔗 RPC: ${this.rpcUrl}`);
        
        if (this.deploymentInfo) {
            console.log(`   🪙 THD Token: ${Utils.formatAddress(this.deploymentInfo.thdToken)}`);
            
            if (this.network === 'sepolia') {
                console.log(`   🔍 Explorer: https://sepolia.etherscan.io/token/${this.deploymentInfo.thdToken}`);
            }
        }
        
        if (this.network === 'sepolia') {
            console.log(`   🚰 Get test ETH: https://sepoliafaucet.com/`);
        }
        
        console.log('');
    }
    
    async setAccount(privateKey) {
        try {
            const account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
            this.web3.eth.accounts.wallet.add(account);
            this.web3.eth.defaultAccount = account.address;
            this.currentAccount = account;
            
            // Affiche le solde ETH
            const ethBalance = await this.web3.eth.getBalance(account.address);
            const ethFormatted = this.web3.utils.fromWei(ethBalance, 'ether');
            
            console.log(`🔐 Account set: ${Utils.formatAddress(account.address)}`);
            console.log(`   ETH Balance: ${parseFloat(ethFormatted).toFixed(4)} ETH`);
            
            // Pour Sepolia, avertit si pas assez d'ETH
            if (this.network === 'sepolia' && parseFloat(ethFormatted) < 0.001) {
                console.log(`   ⚠️  Low ETH balance! Get test ETH: https://sepoliafaucet.com/`);
            }
            
            return account;
        } catch (error) {
            console.error('❌ Failed to set account:', error.message);
            throw error;
        }
    }
    
    async getBalance(address = null) {
        try {
            const targetAddress = address || this.currentAccount?.address;
            if (!targetAddress) {
                throw new Error('No account set');
            }
            
            if (!this.thdContract) {
                throw new Error('THD contract not available. Deploy contracts first.');
            }
            
            const balance = await this.thdContract.methods.balanceOf(targetAddress).call();
            
            return {
                address: targetAddress,
                balance: BigInt(balance),
                formatted: Utils.formatBalance(BigInt(balance))
            };
        } catch (error) {
            console.error('❌ Failed to get balance:', error.message);
            
            if (error.message.includes('not available')) {
                console.error('💡 Deploy contracts first:');
                if (this.network === 'sepolia') {
                    console.error('   npx hardhat run scripts/deploy-sepolia.js --network sepolia');
                } else {
                    console.error('   npm run deploy');
                }
            }
            
            throw error;
        }
    }
    
    async deployPaymentChannel(partA, partB, amount) {
        try {
            if (!this.currentAccount) {
                throw new Error('No account set');
            }
            
            console.log(`🚀 Deploying PaymentChannel on ${this.network}...`);
            console.log(`   Participants: ${Utils.formatAddress(partA)} ↔ ${Utils.formatAddress(partB)}`);
            console.log(`   Amount: ${Utils.formatBalance(BigInt(amount))} THD`);
            
            const channelAbi = require('../../artifacts/contracts/PaymentChannel.sol/PaymentChannel.json').abi;
            const channelBytecode = require('../../artifacts/contracts/PaymentChannel.sol/PaymentChannel.json').bytecode;
            
            const channelContract = new this.web3.eth.Contract(channelAbi);
            
            const deployData = channelContract.deploy({
                data: channelBytecode,
                arguments: [partA, partB, amount, this.deploymentInfo.thdToken]
            }).encodeABI();
            
            // Estimation de gas avec marge
            const gasEstimate = await this.web3.eth.estimateGas({
                from: this.currentAccount.address,
                data: deployData
            });
            
            // Pour Sepolia, utilise un gas price approprié
            let gasPrice;
            if (this.network === 'sepolia') {
                gasPrice = await this.web3.eth.getGasPrice();
                // Ajoute 10% de marge
                gasPrice = (BigInt(gasPrice) * BigInt(110)) / BigInt(100);
            } else {
                gasPrice = await this.web3.eth.getGasPrice();
            }
            
            const tx = {
                from: this.currentAccount.address,
                data: deployData,
                gas: Number(gasEstimate) + 50000, // Marge de sécurité
                gasPrice: gasPrice.toString()
            };
            
            console.log(`   Gas estimate: ${gasEstimate}`);
            console.log(`   Gas price: ${this.web3.utils.fromWei(gasPrice.toString(), 'gwei')} Gwei`);
            
            const signedTx = await this.web3.eth.accounts.signTransaction(tx, this.currentAccount.privateKey);
            const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            
            console.log(`✅ PaymentChannel deployed: ${receipt.contractAddress}`);
            
            if (this.network === 'sepolia') {
                console.log(`   🔍 Explorer: https://sepolia.etherscan.io/address/${receipt.contractAddress}`);
            }
            
            return {
                address: receipt.contractAddress,
                contract: new this.web3.eth.Contract(channelAbi, receipt.contractAddress),
                receipt
            };
        } catch (error) {
            console.error('❌ Failed to deploy payment channel:', error.message);
            
            if (error.message.includes('insufficient funds')) {
                console.error('💡 Not enough ETH for gas fees');
                if (this.network === 'sepolia') {
                    console.error('   Get test ETH: https://sepoliafaucet.com/');
                }
            }
            
            throw error;
        }
    }
    
    async approveToken(spender, amount) {
        try {
            if (!this.currentAccount) {
                throw new Error('No account set');
            }
            
            if (!this.thdContract) {
                throw new Error('THD contract not available');
            }
            
            console.log(`💰 Approving ${Utils.formatBalance(BigInt(amount))} THD...`);
            
            const tx = this.thdContract.methods.approve(spender, amount);
            const gas = await tx.estimateGas({ from: this.currentAccount.address });
            
            // Ajuste le gas price pour Sepolia
            const gasPrice = await this.web3.eth.getGasPrice();
            const adjustedGasPrice = this.network === 'sepolia' 
                ? (BigInt(gasPrice) * BigInt(110)) / BigInt(100)
                : gasPrice;
            
            const receipt = await tx.send({
                from: this.currentAccount.address,
                gas: Number(gas) + 10000,
                gasPrice: adjustedGasPrice.toString()
            });
            
            console.log(`✅ Token approved: ${Utils.formatBalance(BigInt(amount))} THD for ${Utils.formatAddress(spender)}`);
            
            if (this.network === 'sepolia') {
                console.log(`   🔍 Transaction: https://sepolia.etherscan.io/tx/${receipt.transactionHash}`);
            }
            
            return receipt;
        } catch (error) {
            console.error('❌ Failed to approve token:', error.message);
            throw error;
        }
    }
    
    getNetworkInfo() {
        return {
            network: this.network,
            chainId: this.web3.utils.hexToNumber(this.web3.eth.getChainId ? '0x' + this.web3.eth.getChainId().toString(16) : '0x0'),
            connected: this.web3.currentProvider.connected,
            rpc: this.rpcUrl,
            account: this.currentAccount?.address || null,
            thdToken: this.deploymentInfo?.thdToken || null,
            explorer: this.getExplorerUrl()
        };
    }
    
    /**
     * Retourne l'URL de l'explorer selon le réseau
     */
    getExplorerUrl() {
        const explorers = {
            'mainnet': 'https://etherscan.io',
            'sepolia': 'https://sepolia.etherscan.io',
            'localhost': null
        };
        
        return explorers[this.network] || null;
    }
    
    /**
     * Vérifie la connectivité et l'état du réseau
     */
    async healthCheck() {
        try {
            const isConnected = await this.web3.eth.net.isListening();
            const blockNumber = await this.web3.eth.getBlockNumber();
            const gasPrice = await this.web3.eth.getGasPrice();
            
            return {
                connected: isConnected,
                network: this.network,
                blockNumber: Number(blockNumber),
                gasPrice: this.web3.utils.fromWei(gasPrice.toString(), 'gwei') + ' Gwei',
                thdContractAvailable: !!this.thdContract,
                accountSet: !!this.currentAccount
            };
        } catch (error) {
            return {
                connected: false,
                error: error.message
            };
        }
    }
}

module.exports = BlockchainManager;