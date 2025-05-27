const hre = require("hardhat");

async function main() {
    const blocksToMine = process.argv[2] || 25;
    
    console.log(`⛏️  Mining ${blocksToMine} blocks...`);
    
    const startBlock = await hre.ethers.provider.getBlockNumber();
    console.log(`Starting block: ${startBlock}`);
    
    for (let i = 0; i < blocksToMine; i++) {
        await hre.network.provider.send("evm_mine");
        if (i % 5 === 0 || i === blocksToMine - 1) {
            const currentBlock = await hre.ethers.provider.getBlockNumber();
            console.log(`   Mined ${i + 1}/${blocksToMine} blocks (current: ${currentBlock})`);
        }
    }
    
    const finalBlock = await hre.ethers.provider.getBlockNumber();
    console.log(`✅ Mining complete!`);
    console.log(`   Final block: ${finalBlock}`);
    console.log(`   Blocks mined: ${finalBlock - startBlock}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });