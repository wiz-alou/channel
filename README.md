# ⚡ Thunder Payment Channel

A complete implementation of payment channels on Ethereum using THD tokens.

## 🚀 Quick Start

### Prerequisites
- Node.js 16+
- npm or yarn

### Installation

```bash
# Clone and setup
git clone <repository>
cd thunder-payment-channel
npm install

# Start local blockchain
npm run node

# Deploy contracts (in another terminal)
npm run deploy

# Start Thunder node
npm run thunderd

# Use CLI (in another terminal)
npm run thunder-cli -- --help
```

## 📖 Documentation

### Smart Contracts

#### THDToken (ERC20)
- Name: Thunder Token
- Symbol: THD
- Decimals: 18
- Initial supply: 1,000,000 THD

#### PaymentChannel
Payment channel contract supporting:
- Two-party channels
- Off-chain payments
- Challenge period (24 blocks)
- Secure state transitions

**States:**
- `EMPTY` - Channel created, waiting for funding
- `ACTIVE` - Both parties funded, payments possible
- `CLOSING` - Channel closing, challenge period active
- `CLOSED` - Final state, funds withdrawn

### Architecture

```
┌─────────────┐    ┌─────────────────┐    ┌─────────────┐
│   User A    │    │   Blockchain    │    │   User B    │
│             │    │                 │    │             │
│ thunder-cli │◄──►│ PaymentChannel  │◄──►│ thunder-cli │
│             │    │   THD Token     │    │             │
│ thunderd    │    │                 │    │ thunderd    │
└─────────────┘    └─────────────────┘    └─────────────┘
       ▲                                           ▲
       │            P2P Communication              │
       └───────────────────────────────────────────┘
```

## 🛠️ Commands

### thunderd (Node Server)

```bash
# Start default node
thunderd

# Start on custom port
thunderd --port 2002

# Connect to custom RPC
thunderd --rpc http://localhost:8545
```

**Options:**
- `--port <port>` - Server port (default: 2001)
- `--rpc <url>` - RPC endpoint (default: http://127.0.0.1:8545)
- `--help` - Show help

### thunder-cli (Command Line Interface)

```bash
# Show help
thunder-cli --help

# Connect to custom node
thunder-cli --port 2002 <command>
```

**Commands:**

#### Node Management
```bash
# Show node information
thunder-cli infos

# Import wallet from seed phrase
thunder-cli importwallet "abandon abandon abandon..."

# Show balances
thunder-cli balance
```

#### Network
```bash
# Connect to another node
thunder-cli connect localhost:2002
```

#### Payment Channels
```bash
# Open payment channel with 10 THD
thunder-cli openchannel 10

# Send 5 THD payment
thunder-cli pay 5

# Close the channel
thunder-cli closechannel

# Withdraw funds (after challenge period)
thunder-cli withdraw
```

## 🧪 Testing

### Full Workflow Test

1. **Setup**
```bash
# Terminal 1: Start blockchain
npm run node

# Terminal 2: Deploy contracts
npm run deploy

# Terminal 3: Start first node
npm run thunderd
```

2. **Import wallet and setup**
```bash
# Terminal 4: Use CLI
npm run thunder-cli -- importwallet "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
npm run thunder-cli -- balance
npm run thunder-cli -- connect localhost:2002
```

3. **Channel operations**
```bash
# Open channel with 10 THD
npm run thunder-cli -- openchannel 10

# Check balances (should show 990 available, 5 in channel)
npm run thunder-cli -- balance

# Send payment
npm run thunder-cli -- pay 5

# Check updated balances
npm run thunder-cli -- balance

# View channel info
npm run thunder-cli -- infos
```

4. **Channel closing**
```bash
# Close channel
npm run thunder-cli -- closechannel

# Mine blocks to pass challenge period
npm run mine-blocks 25

# Withdraw funds
npm run thunder-cli -- withdraw

# Check final balances
npm run thunder-cli -- balance
```

### Two-Node Testing

```bash
# Terminal 1: Node A
thunderd --port 2001

# Terminal 2: Node B  
thunderd --port 2002

# Terminal 3: CLI A
thunder-cli --port 2001 importwallet "abandon abandon abandon..."
thunder-cli --port 2001 connect localhost:2002

# Terminal 4: CLI B
thunder-cli --port 2002 importwallet "test test test..."
```

## 🔧 Available Scripts

```bash
# Blockchain
npm run node          # Start Hardhat local network
npm run compile       # Compile smart contracts
npm run deploy        # Deploy contracts to localhost
npm run clean         # Clean compilation artifacts

# Thunder
npm run thunderd      # Start Thunder node (port 2001)
npm run thunder-cli   # Run Thunder CLI

# Utilities
npm run mine-blocks   # Mine blocks for testing
npm run test         # Run tests
```

## 🏗️ Project Structure

```
thunder-payment-channel/
├── contracts/               # Smart contracts
│   ├── THDToken.sol        # ERC20 token
│   └── PaymentChannel.sol  # Payment channel logic
├── src/
│   ├── thunderd/           # Node server
│   │   ├── server.js       # Express server
│   │   ├── blockchain.js   # Web3 integration
│   │   └── channel.js      # Channel management
│   ├── thunder-cli/        # Command line interface
│   │   ├── cli.js          # CLI setup
│   │   └── commands.js     # Command implementations
│   └── shared/             # Shared utilities
│       └── utils.js        # Helper functions
├── scripts/                # Deployment scripts
│   ├── deploy.js          # Contract deployment
│   └── mine-blocks.js     # Block mining utility
├── deployments/           # Deployment artifacts
├── test/                  # Test files
└── artifacts/            # Compiled contracts
```

## 🔐 Security Features

### Payment Channel Security
- **Two-party signatures** required for state changes
- **Challenge period** prevents fraudulent closing
- **Nonce-based ordering** prevents replay attacks
- **Balance validation** ensures conservation of funds

### Smart Contract Security
- **Access control** - only channel participants can interact
- **State validation** - proper state transitions enforced
- **Overflow protection** - using Solidity 0.8.20+ built-in checks
- **Reentrancy protection** - careful state updates

## 🌐 Network Support

### Platforms
- **Linux AMD64** ✅
- **macOS ARM64** ✅  
- **macOS AMD64** ✅
- **Windows AMD64** ✅

### Networks
- **Hardhat Local** (development)
- **Ethereum Testnets** (configurable)
- **Ethereum Mainnet** (production ready)

## 📊 Example Session

```bash
$ thunder-cli infos
📊 Thunder Node Information
==========================
Port: 2001
Wallet: 0x7099...79C8
Connected Peers: 1
Active Channels: 0

$ thunder-cli balance
💰 Account Balance
==================
Total THD: 1000.0000
Available THD: 1000.0000
Channel THD: 0.0000

$ thunder-cli openchannel 10
✅ Channel opened with 10 THD
   Channel ID: abc123
   Channel Address: 0x1234...5678

$ thunder-cli pay 5
✅ Payment of 5 THD sent
   Payment ID: def456
   New Nonce: 1

$ thunder-cli balance
💰 Account Balance
==================
Total THD: 995.0000
Available THD: 990.0000
Channel THD: 5.0000
Channel Balance: 0.0000
```

## 🛡️ Troubleshooting

### Common Issues

1. **"Cannot connect to Thunder node"**
   - Ensure `thunderd` is running
   - Check port configuration

2. **"No wallet imported"**
   - Import wallet using `importwallet` command

3. **"Channel not active"**
   - Wait for both parties to fund the channel
   - Check channel state with `infos`

4. **"Challenge period not expired"**
   - Wait 24 blocks after channel closing
   - Use `mine-blocks` script for testing

### Getting Help

For issues and questions:
1. Check this README
2. Review command help: `thunder-cli --help`
3. Check server logs in thunderd terminal

## 🚀 Future Enhancements

- Multi-hop routing (Lightning Network style)
- Web interface
- Mobile applications
- Multi-token support
- Watchtower services
- Channel backup/restore

---

**Thunder v0.0.1** - Built with ⚡ for fast, secure payments