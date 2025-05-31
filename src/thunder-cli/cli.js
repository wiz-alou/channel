#!/usr/bin/env node

/**
 * DESCRIPTION:
 * Interface en ligne de commande pour Thunder Payment Channels.
 * Supporte DEUX syntaxes :
 * 1. Options avec -- : thunder-cli --infos, --balance, --proposals, etc.
 * 2. Commandes classiques : thunder-cli infos, balance, proposals, etc.
 * 
 * NOUVELLES OPTIONS DISPONIBLES:
 * --infos, --balance, --proposals, --connect, --importwallet, etc.
 * 
 * NOUVEAU WORKFLOW P2P:
 * - proposechannel: Proposer un channel à un peer
 * - acceptchannel: Accepter une proposition reçue
 * - createchannel: Créer le smart contract
 * - fundchannel: Financer sa part du channel
 * 
 * PAIEMENTS:
 * - pay: Envoyer un paiement off-chain
 * - closechannel: Fermer un channel
 * - withdraw: Retirer les fonds
 */

const { Command } = require('commander');
const Commands = require('./commands');

class ThunderCLI {
    constructor() {
        this.program = new Command();
        this.commands = new Commands();
        this.setupCommands();
    }
    
    setupCommands() {
        this.program
            .name('thunder-cli')
            .description('Thunder Payment Channel CLI - P2P Payment Channels on Ethereum')
            .version('1.0.0')
            .option('--port <port>', 'Thunder node port', '2001')
            .option('--host <host>', 'Thunder node host', 'localhost');
        
        // === OPTIONS AVEC -- (NOUVELLE SYNTAXE) ===
        
        this.program
            .option('--infos', 'Display information about the node (port, peers, channels, proposals)')
            .option('--balance', 'Show THD balance: total, available, locked in channels')
            .option('--proposals', 'List all pending channel proposals (sent and received)')
            .option('--importwallet <seedphrase>', 'Import a wallet using a seed phrase')
            .option('--connect <address>', 'Connect to another thunder node (format: ip:port)')
            .option('--proposechannel <peer> [amount]', 'Propose a payment channel to another peer')
            .option('--acceptchannel <proposalId>', 'Accept a channel proposal you received')
            .option('--createchannel <proposalId>', 'Create the smart contract from an accepted proposal')
            .option('--fundchannel <channelId>', 'Fund your part of a created channel')
            .option('--pay <amount>', 'Send an off-chain payment through an active channel')
            .option('--closechannel', 'Close an active channel (submits latest state to blockchain)')
            .option('--withdraw', 'Withdraw funds from a closed channel (after challenge period)')
            .option('--openchannel [amount]', '⚠️ DEPRECATED: Use the new P2P workflow instead');
        
        // === COMMANDES CLASSIQUES (RÉTROCOMPATIBILITÉ) ===
        
        this.program
            .command('infos')
            .description('Display information about the node (port, peers, channels, proposals)')
            .action(async () => {
                await this.commands.infos(this.getNodeUrl());
            });
        
        this.program
            .command('importwallet <seedphrase>')
            .description('Import a wallet using a seed phrase')
            .action(async (seedphrase) => {
                await this.commands.importWallet(this.getNodeUrl(), seedphrase);
            });
        
        this.program
            .command('balance')
            .description('Shows THD balance: total, available, locked in channels, channel balance')
            .action(async () => {
                await this.commands.balance(this.getNodeUrl());
            });
        
        this.program
            .command('connect <address>')
            .description('Connect to another thunder node (format: ip:port)')
            .action(async (address) => {
                await this.commands.connect(this.getNodeUrl(), address);
            });
        
        // === NOUVEAU WORKFLOW P2P ===
        
        this.program
            .command('proposechannel <peer> [amount]')
            .description('Propose a payment channel to another peer')
            .action(async (peer, amount = '10') => {
                await this.commands.proposeChannel(this.getNodeUrl(), peer, amount);
            });
        
        this.program
            .command('acceptchannel <proposalId>')
            .description('Accept a channel proposal you received')
            .action(async (proposalId) => {
                await this.commands.acceptChannel(this.getNodeUrl(), proposalId);
            });
        
        this.program
            .command('createchannel <proposalId>')
            .description('Create the smart contract from an accepted proposal')
            .action(async (proposalId) => {
                await this.commands.createChannel(this.getNodeUrl(), proposalId);
            });
        
        this.program
            .command('fundchannel <channelId>')
            .description('Fund your part of a created channel')
            .action(async (channelId) => {
                await this.commands.fundChannel(this.getNodeUrl(), channelId);
            });
        
        this.program
            .command('proposals')
            .description('List all pending channel proposals (sent and received)')
            .action(async () => {
                await this.commands.listProposals(this.getNodeUrl());
            });
        
        // === PAIEMENTS ===
        
        this.program
            .command('pay <amount>')
            .description('Send an off-chain payment through an active channel')
            .action(async (amount) => {
                await this.commands.pay(this.getNodeUrl(), amount);
            });
        
        this.program
            .command('closechannel')
            .description('Close an active channel (submits latest state to blockchain)')
            .action(async () => {
                await this.commands.closeChannel(this.getNodeUrl());
            });
        
        this.program
            .command('withdraw')
            .description('Withdraw funds from a closed channel (after challenge period)')
            .action(async () => {
                await this.commands.withdraw(this.getNodeUrl());
            });
        
        // === RÉTROCOMPATIBILITÉ ===
        
        this.program
            .command('openchannel [amount]')
            .description('⚠️  DEPRECATED: Use the new P2P workflow instead')
            .action(async (amount = '10') => {
                console.log('⚠️  DEPRECATED COMMAND');
                console.log('=====================================');
                console.log('Please use the new P2P workflow:');
                console.log('');
                console.log('1. thunder-cli proposechannel <peer> <amount>');
                console.log('2. thunder-cli acceptchannel <proposalId> (on peer)');
                console.log('3. thunder-cli createchannel <proposalId>');
                console.log('4. thunder-cli fundchannel <channelId> (both parties)');
                console.log('');
                console.log('This ensures both parties consent to the channel.');
                console.log('');
                console.log('Falling back to old method for compatibility...');
                await this.commands.openChannel(this.getNodeUrl(), amount);
            });
        
        // === ACTION PRINCIPALE POUR GÉRER LES OPTIONS -- ===
        
        this.program.action(async (options) => {
            const nodeUrl = this.getNodeUrl();
            
            // Gère les options avec --
            if (options.infos) {
                await this.commands.infos(nodeUrl);
            } else if (options.balance) {
                await this.commands.balance(nodeUrl);
            } else if (options.proposals) {
                await this.commands.listProposals(nodeUrl);
            } else if (options.importwallet) {
                await this.commands.importWallet(nodeUrl, options.importwallet);
            } else if (options.connect) {
                await this.commands.connect(nodeUrl, options.connect);
            } else if (options.proposechannel) {
                // Parse "peer amount" ou juste "peer"
                const args = options.proposechannel.split(' ');
                const peer = args[0];
                const amount = args[1] || '10';
                await this.commands.proposeChannel(nodeUrl, peer, amount);
            } else if (options.acceptchannel) {
                await this.commands.acceptChannel(nodeUrl, options.acceptchannel);
            } else if (options.createchannel) {
                await this.commands.createChannel(nodeUrl, options.createchannel);
            } else if (options.fundchannel) {
                await this.commands.fundChannel(nodeUrl, options.fundchannel);
            } else if (options.pay) {
                await this.commands.pay(nodeUrl, options.pay);
            } else if (options.closechannel) {
                await this.commands.closeChannel(nodeUrl);
            } else if (options.withdraw) {
                await this.commands.withdraw(nodeUrl);
            } else if (options.openchannel) {
                const amount = options.openchannel === true ? '10' : options.openchannel;
                console.log('⚠️  DEPRECATED COMMAND');
                console.log('=====================================');
                console.log('Please use the new P2P workflow:');
                console.log('');
                console.log('1. thunder-cli --proposechannel "<peer> <amount>"');
                console.log('2. thunder-cli --acceptchannel <proposalId> (on peer)');
                console.log('3. thunder-cli --createchannel <proposalId>');
                console.log('4. thunder-cli --fundchannel <channelId> (both parties)');
                console.log('');
                console.log('Falling back to old method for compatibility...');
                await this.commands.openChannel(nodeUrl, amount);
            } else {
                // Aucune option spécifiée - affiche l'aide
                this.program.help();
            }
        });
    }
    
    getNodeUrl() {
        const options = this.program.opts();
        return `http://${options.host}:${options.port}`;
    }
    
    run() {
        // Si aucun argument n'est fourni, affiche l'aide
        if (process.argv.length <= 2) {
            this.program.help();
            return;
        }
        
        this.program.parse();
    }
}

if (require.main === module) {
    const cli = new ThunderCLI();
    cli.run();
}

module.exports = ThunderCLI;