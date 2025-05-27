const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const [deployer, user1, user2] = await hre.ethers.getSigners();
    
    console.log("Deploying contracts with account:", deployer.address);
    console.log("Account balance:", (await deployer.provider.getBalance(deployer.address)).toString());
    
    // Deploy THD Token
    const THDToken = await hre.ethers.getContractFactory("THDToken");
    const initialSupply = 100000; // 1M THD
    const thdToken = await THDToken.deploy(initialSupply);
    await thdToken.waitForDeployment();
    
    console.log("THD Token deployed to:", await thdToken.getAddress());
    
    // Fund test accounts
    const fundAmount = hre.ethers.parseEther("100");
    await thdToken.transfer(user1.address, fundAmount);
    await thdToken.transfer(user2.address, fundAmount);
    
    console.log("Funded user1:", user1.address, "with 100 THD");
    console.log("Funded user2:", user2.address, "with 100 THD");
    
    // Save deployment info
    const deploymentInfo = {
        network: hre.network.name,
        thdToken: await thdToken.getAddress(),
        deployer: deployer.address,
        user1: user1.address,
        user2: user2.address,
        blockNumber: await hre.ethers.provider.getBlockNumber()
    };
    
    // Create deployment directory if it doesn't exist
    const deployDir = path.join(__dirname, "..", "deployments");
    if (!fs.existsSync(deployDir)) {
        fs.mkdirSync(deployDir);
    }
    
    fs.writeFileSync(
        path.join(deployDir, `${hre.network.name}.json`),
        JSON.stringify(deploymentInfo, null, 2)
    );
    
    console.log("Deployment info saved to deployments/", hre.network.name + ".json");
    
    return deploymentInfo;
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = main;