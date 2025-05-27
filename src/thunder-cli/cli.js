#!/usr/bin/env node

/**
 * 
 * DESCRIPTION:
 * Interface en ligne de commande pour Thunder Payment Channels.
 * Gère toutes les commandes utilisateur avec le nouveau workflow P2P.
 * 
 * COMMANDES PRINCIPALES:
 * - infos: Informations sur le node
 * - importwallet: Importer un wallet
 * - balance: Voir les soldes
 * - connect: Se connecter à un peer
 * 
 * NOUVEAU WORKFLOW P2P:
 * - proposechannel: Proposer un channel à un peer
 * - acceptchannel: Accepter une proposition reçue
 * - createchannel: Créer le smart contract
 * - fundchannel: Financer sa part du channel
 * - proposals: Lister les propositions
 * 
 * PAIEMENTS:
 * - pay: Envoyer un paiement off-chain
 * - closechannel: Fermer un channel
 * - withdraw: Retirer les fonds
 * 
 * USAGE:
 * thunder-cli --port 2001 proposechannel localhost:2002 10
 * thunder-cli --port 2002 acceptchannel <proposalId>
 * thunder-cli createchannel <proposalId>
 * thunder-cli fundchannel <channelId>
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
        
        // === COMMANDES DE BASE ===
        
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
    }
    
    getNodeUrl() {
        const options = this.program.opts();
        return `http://${options.host}:${options.port}`;
    }
    
    run() {
        this.program.parse();
    }
}

if (require.main === module) {
    const cli = new ThunderCLI();
    cli.run();
}

module.exports = ThunderCLI;