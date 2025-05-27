const { Web3 } = require('web3');
const Utils = require('../shared/utils');

class BlockchainManager {
    constructor(rpcUrl = 'http://127.0.0.1:8545') {
        this.web3 = new Web3(rpcUrl);
        this.deploymentInfo = null;
        this.thdContract = null;
        this.currentAccount = null;
    }
    
    async initialize() {
        try {
            // Load deployment info
            this.deploymentInfo = Utils.loadDeploymentInfo();
            
            // Check connection
            const isConnected = await this.web3.eth.net.isListening();
            if (!isConnected) {
                throw new Error('Cannot connect to blockchain');
            }
            
            // Load THD token contract
            const thdAbi = require('../../artifacts/contracts/THDToken.sol/THDToken.json').abi;
            this.thdContract = new this.web3.eth.Contract(thdAbi, this.deploymentInfo.thdToken);
            
            console.log('✅ Blockchain connected');
            console.log(`   RPC: ${this.web3.currentProvider.host}`);
            console.log(`   Network: ${await this.web3.eth.net.getId()}`);
            console.log(`   THD Token: ${this.deploymentInfo.thdToken}`);
            
            return true;
        } catch (error) {
            console.error('❌ Blockchain initialization failed:', error.message);
            throw error;
        }
    }
    
    async setAccount(privateKey) {
        try {
            const account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
            this.web3.eth.accounts.wallet.add(account);
            this.web3.eth.defaultAccount = account.address;
            this.currentAccount = account;
            
            console.log(`✅ Account set: ${Utils.formatAddress(account.address)}`);
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
            
            const balance = await this.thdContract.methods.balanceOf(targetAddress).call();
            return {
                address: targetAddress,
                balance: BigInt(balance),
                formatted: Utils.formatBalance(BigInt(balance))
            };
        } catch (error) {
            console.error('❌ Failed to get balance:', error.message);
            throw error;
        }
    }
    
    async deployPaymentChannel(partA, partB, amount) {
        try {
            if (!this.currentAccount) {
                throw new Error('No account set');
            }
            
            const channelAbi = require('../../artifacts/contracts/PaymentChannel.sol/PaymentChannel.json').abi;
            const channelBytecode = require('../../artifacts/contracts/PaymentChannel.sol/PaymentChannel.json').bytecode;
            
            const channelContract = new this.web3.eth.Contract(channelAbi);
            
            const deployData = channelContract.deploy({
                data: channelBytecode,
                arguments: [partA, partB, amount, this.deploymentInfo.thdToken]
            }).encodeABI();
            
            const gasEstimate = await this.web3.eth.estimateGas({
                from: this.currentAccount.address,
                data: deployData
            });
            
            const tx = {
                from: this.currentAccount.address,
                data: deployData,
                gas: gasEstimate,
                gasPrice: await this.web3.eth.getGasPrice()
            };
            
            const signedTx = await this.web3.eth.accounts.signTransaction(tx, this.currentAccount.privateKey);
            const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            
            console.log(`✅ Payment Channel deployed: ${receipt.contractAddress}`);
            
            return {
                address: receipt.contractAddress,
                contract: new this.web3.eth.Contract(channelAbi, receipt.contractAddress),
                receipt
            };
        } catch (error) {
            console.error('❌ Failed to deploy payment channel:', error.message);
            throw error;
        }
    }
    
    async approveToken(spender, amount) {
        try {
            if (!this.currentAccount) {
                throw new Error('No account set');
            }
            
            const tx = this.thdContract.methods.approve(spender, amount);
            const gas = await tx.estimateGas({ from: this.currentAccount.address });
            
            const receipt = await tx.send({
                from: this.currentAccount.address,
                gas: gas
            });
            
            console.log(`✅ Token approved: ${amount} THD for ${Utils.formatAddress(spender)}`);
            return receipt;
        } catch (error) {
            console.error('❌ Failed to approve token:', error.message);
            throw error;
        }
    }
    
    getNetworkInfo() {
        return {
            connected: this.web3.currentProvider.connected,
            rpc: this.web3.currentProvider.host,
            account: this.currentAccount?.address || null,
            thdToken: this.deploymentInfo?.thdToken || null
        };
    }
}

module.exports = BlockchainManager;