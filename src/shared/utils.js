const fs = require('fs');
const path = require('path');

class Utils {
    static loadDeploymentInfo(network = 'localhost') {
        try {
            const deploymentPath = path.join(__dirname, '..', '..', 'deployments', `${network}.json`);
            return JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
        } catch (error) {
            throw new Error(`Failed to load deployment info for network ${network}: ${error.message}`);
        }
    }
    
    static formatAddress(address) {
        if (!address) return 'N/A';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }
    
    static formatBalance(balance, decimals = 18) {
        const divisor = BigInt(10 ** decimals);
        const wholePart = balance / divisor;
        const fractionalPart = balance % divisor;
        return `${wholePart}.${fractionalPart.toString().padStart(decimals, '0').slice(0, 4)}`;
    }
    
    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    static generateId() {
        return Math.random().toString(36).substr(2, 9);
    }
}

module.exports = Utils;