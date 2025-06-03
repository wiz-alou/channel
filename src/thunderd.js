#!/usr/bin/env node

const { Command } = require('commander');
const ThunderdServer = require('./thunderd/server');
require('dotenv').config();

const program = new Command();

program
    .name('thunderd')
    .description('Thunder Payment Channel Node - Multi-Network Support')
    .version('1.0.0-sepolia')
    .option('--rpc <url>', 'RPC endpoint URL (auto-detects network)', process.env.SEPOLIA_RPC_URL || 'http://127.0.0.1:8545')
    .option('--port <port>', 'Server port', '2001')
    .option('--network <network>', 'Network name (localhost, sepolia, mainnet)', 'auto')
    .option('--help', 'Show detailed help with examples')
    .action(async (options) => {
        if (options.help) {
            showDetailedHelp();
            return;
        }
        
        try {
            const port = parseInt(options.port);
            const rpcUrl = options.rpc;
            
            // Détection automatique du réseau
            let detectedNetwork = 'localhost';
            if (rpcUrl.includes('sepolia')) {
                detectedNetwork = 'sepolia';
            } else if (rpcUrl.includes('mainnet') || rpcUrl.includes('cloudflare')) {
                detectedNetwork = 'mainnet';
            } else if (rpcUrl.includes('polygon')) {
                detectedNetwork = 'polygon';
            }
            
            const networkToUse = options.network === 'auto' ? detectedNetwork : options.network;
            
            console.log('⚡ Thunder Payment Channel Node');
            console.log('================================');
            console.log(`Version: 1.0.0-sepolia`);
            console.log(`Port: ${port}`);
            console.log(`RPC: ${rpcUrl}`);
            console.log(`Network: ${networkToUse.toUpperCase()}`);
            console.log('');
            
            // Vérifications spécifiques selon le réseau
            if (networkToUse === 'sepolia') {
                console.log('🌐 Sepolia Network Configuration');
                console.log('================================');
                
                if (!process.env.SEPOLIA_RPC_URL && rpcUrl.includes('127.0.0.1')) {
                    console.log('⚠️  Using localhost RPC but Sepolia network specified');
                    console.log('💡 Set SEPOLIA_RPC_URL in .env or use --rpc flag');
                    console.log('   Example: thunderd --rpc https://sepolia.infura.io/v3/YOUR_KEY');
                }
                
                console.log('🔗 Useful Sepolia links:');
                console.log('   🚰 Faucet: https://sepoliafaucet.com/');
                console.log('   🔍 Explorer: https://sepolia.etherscan.io/');
                console.log('   📚 RPC List: https://chainlist.org/chain/11155111');
                console.log('');
            }
            
            const server = new ThunderdServer(port, rpcUrl);
            await server.start();
            
            // Instructions post-démarrage selon le réseau
            if (networkToUse === 'sepolia') {
                console.log('');
                console.log('🎯 Ready for Sepolia testing!');
                console.log('=============================');
                console.log('Your node is now connected to the Sepolia testnet.');
                console.log('Others can connect to you from anywhere in the world!');
                console.log('');
                console.log('📋 Next steps for testing:');
                console.log('1. Import a test wallet:');
                console.log('   thunder-cli importwallet "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"');
                console.log('');
                console.log('2. Share your public IP with testers:');
                console.log('   • Find your IP: curl ifconfig.me');
                console.log('   • Open port in router/firewall');
                console.log('   • Share: <YOUR_PUBLIC_IP>:' + port);
                console.log('');
                console.log('3. Connect with other testers:');
                console.log('   thunder-cli connect <THEIR_IP>:2001');
                console.log('');
                console.log('4. Create payment channels:');
                console.log('   thunder-cli proposechannel <THEIR_IP>:2001 10');
                console.log('');
                console.log('🌍 Global testing enabled! 🚀');
            }
            
            // Handle graceful shutdown
            process.on('SIGINT', () => {
                console.log('\n🛑 Shutting down Thunder node...');
                console.log('Goodbye! ⚡');
                process.exit(0);
            });
            
        } catch (error) {
            console.error('❌ Failed to start Thunder node:', error.message);
            
            // Messages d'aide spécifiques
            if (error.message.includes('EADDRINUSE')) {
                console.error(`💡 Port ${options.port} is already in use`);
                console.error('   Try a different port: thunderd --port 2002');
                console.error('   Or kill existing process: pkill -f thunderd');
            } else if (error.message.includes('connect') || error.message.includes('RPC')) {
                console.error('💡 RPC connection failed');
                console.error('   Check your internet connection');
                console.error('   Verify RPC URL is correct');
                if (options.rpc.includes('infura') || options.rpc.includes('alchemy')) {
                    console.error('   Ensure your API key is valid');
                }
                console.error('   Try a different RPC provider');
            } else if (error.message.includes('deployment')) {
                console.error('💡 Contracts not deployed');
                console.error('   Deploy first: npm run deploy:sepolia');
                console.error('   Or check deployments/ folder');
            }
            
            process.exit(1);
        }
    });

function showDetailedHelp() {
    console.log('⚡ Thunder Payment Channel Node - Detailed Help');
    console.log('===============================================');
    console.log('');
    console.log('📖 DESCRIPTION:');
    console.log('Thunder creates Lightning Network-style payment channels on Ethereum.');
    console.log('Supports multiple networks: localhost (development), Sepolia (testing), mainnet.');
    console.log('');
    console.log('🚀 QUICK START:');
    console.log('');
    console.log('1. Development (localhost):');
    console.log('   thunderd                           # Uses local Hardhat node');
    console.log('');
    console.log('2. Testing (Sepolia):');
    console.log('   thunderd --rpc https://sepolia.infura.io/v3/YOUR_KEY');
    console.log('   thunderd --rpc $SEPOLIA_RPC_URL    # Uses .env variable');
    console.log('');
    console.log('3. Production (mainnet):');
    console.log('   thunderd --rpc https://cloudflare-eth.com');
    console.log('');
    console.log('⚙️  CONFIGURATION OPTIONS:');
    console.log('');
    console.log('  --port <port>     Server port (default: 2001)');
    console.log('                    Use different ports for multiple nodes');
    console.log('                    Example: thunderd --port 2002');
    console.log('');
    console.log('  --rpc <url>       Blockchain RPC endpoint');
    console.log('                    Examples:');
    console.log('                    • Local: http://127.0.0.1:8545');
    console.log('                    • Sepolia: https://sepolia.infura.io/v3/KEY');
    console.log('                    • Mainnet: https://cloudflare-eth.com');
    console.log('');
    console.log('  --network <name>  Force network detection (auto, localhost, sepolia, mainnet)');
    console.log('                    Usually auto-detected from RPC URL');
    console.log('');
    console.log('🌐 NETWORK-SPECIFIC EXAMPLES:');
    console.log('');
    console.log('💻 Localhost Development:');
    console.log('   # Terminal 1: Start Hardhat');
    console.log('   npm run node');
    console.log('   ');
    console.log('   # Terminal 2: Deploy contracts');
    console.log('   npm run deploy');
    console.log('   ');
    console.log('   # Terminal 3: Start Thunder');
    console.log('   thunderd');
    console.log('   ');
    console.log('   # Terminal 4: Use CLI');
    console.log('   thunder-cli importwallet "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"');
    console.log('');
    console.log('🧪 Sepolia Testing:');
    console.log('   # 1. Setup environment');
    console.log('   echo "SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY" > .env');
    console.log('   echo "PRIVATE_KEY=0xYOUR_TEST_PRIVATE_KEY" >> .env');
    console.log('   ');
    console.log('   # 2. Deploy to Sepolia');
    console.log('   npm run deploy:sepolia');
    console.log('   ');
    console.log('   # 3. Start Thunder on Sepolia');
    console.log('   thunderd --rpc $SEPOLIA_RPC_URL');
    console.log('   ');
    console.log('   # 4. Import test wallet');
    console.log('   thunder-cli importwallet "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"');
    console.log('   ');
    console.log('   # 5. Connect with others globally');
    console.log('   thunder-cli connect <THEIR_PUBLIC_IP>:2001');
    console.log('');
    console.log('🌍 Multi-User Sepolia Testing:');
    console.log('   # Alice (Computer 1):');
    console.log('   thunderd --rpc https://sepolia.infura.io/v3/ALICE_KEY --port 2001');
    console.log('   ');
    console.log('   # Bob (Computer 2, anywhere in the world):');
    console.log('   thunderd --rpc https://sepolia.infura.io/v3/BOB_KEY --port 2001');
    console.log('   ');
    console.log('   # Alice connects to Bob:');
    console.log('   thunder-cli connect <BOB_PUBLIC_IP>:2001');
    console.log('   ');
    console.log('   # Create payment channels and test!');
    console.log('   thunder-cli proposechannel <BOB_PUBLIC_IP>:2001 10');
    console.log('');
    console.log('🔧 ENVIRONMENT VARIABLES:');
    console.log('');
    console.log('Create a .env file with:');
    console.log('   SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID');
    console.log('   PRIVATE_KEY=0xYOUR_TEST_PRIVATE_KEY');
    console.log('   ETHERSCAN_API_KEY=YOUR_ETHERSCAN_KEY');
    console.log('');
    console.log('🚰 GET TEST ETH (Sepolia):');
    console.log('   • https://sepoliafaucet.com/');
    console.log('   • https://faucets.chain.link/sepolia');
    console.log('   • Request 0.1 ETH daily per wallet');
    console.log('');
    console.log('🔍 EXPLORERS:');
    console.log('   • Sepolia: https://sepolia.etherscan.io/');
    console.log('   • Mainnet: https://etherscan.io/');
    console.log('');
    console.log('📚 MORE HELP:');
    console.log('   • README.md - Complete documentation');
    console.log('   • SEPOLIA_SETUP.md - Sepolia-specific guide');
    console.log('   • thunder-cli --help - CLI commands');
    console.log('   • GitHub Issues - Report bugs');
    console.log('');
    console.log('💡 TROUBLESHOOTING:');
    console.log('');
    console.log('Port in use:');
    console.log('   thunderd --port 2002');
    console.log('');
    console.log('RPC connection failed:');
    console.log('   • Check internet connection');
    console.log('   • Verify API key');
    console.log('   • Try different RPC provider');
    console.log('');
    console.log('Contracts not deployed:');
    console.log('   npm run deploy:sepolia  # For Sepolia');
    console.log('   npm run deploy          # For localhost');
    console.log('');
    console.log('Low ETH balance:');
    console.log('   • Use faucets for testnet ETH');
    console.log('   • Check wallet has funds for gas');
    console.log('');
    console.log('⚡ Ready to revolutionize payments? Start your Thunder node! 🚀');
}

program.parse();