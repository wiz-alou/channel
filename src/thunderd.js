#!/usr/bin/env node

const { Command } = require('commander');
const ThunderdServer = require('./thunderd/server');
require('dotenv').config();

const program = new Command();

program
    .name('thunderd')
    .description('Thunder Payment Channel Node')
    .version('0.0.1')
    .option('--rpc <url>', 'RPC endpoint URL', 'http://127.0.0.1:8545')
    .option('--port <port>', 'Server port', '2001')
    .option('--help', 'Show help')
    .action(async (options) => {
        if (options.help) {
            program.help();
            return;
        }
        
        try {
            const port = parseInt(options.port);
            const server = new ThunderdServer(port);
            
            console.log('⚡ Thunder Payment Channel Node');
            console.log('================================');
            console.log(`Version: 0.0.1`);
            console.log(`Port: ${port}`);
            console.log(`RPC: ${options.rpc}`);
            console.log('');
            
            await server.start();
            
            // Handle graceful shutdown
            process.on('SIGINT', () => {
                console.log('\n🛑 Shutting down Thunder node...');
                process.exit(0);
            });
            
        } catch (error) {
            console.error('❌ Failed to start Thunder node:', error.message);
            process.exit(1);
        }
    });

program.parse();