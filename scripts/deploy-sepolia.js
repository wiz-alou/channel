const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    console.log("⚡ Thunder Payment Channel - Déploiement Sepolia");
    console.log("================================================");
    
    // Vérification réseau
    const network = hre.network.name;
    if (network !== 'sepolia') {
        throw new Error(`❌ Réseau incorrect: ${network}. Utilisez: npx hardhat run scripts/deploy-sepolia.js --network sepolia`);
    }
    
    const [deployer] = await hre.ethers.getSigners();
    
    console.log("🔐 Compte de déploiement:", deployer.address);
    
    // Vérification du solde ETH
    const balance = await deployer.provider.getBalance(deployer.address);
    const balanceEth = hre.ethers.formatEther(balance);
    console.log("💰 Solde ETH:", balanceEth, "ETH");
    
    if (parseFloat(balanceEth) < 0.01) {
        console.log("⚠️  Solde faible ! Vous pouvez obtenir des ETH de test:");
        console.log("   🚰 Sepolia Faucet: https://sepoliafaucet.com/");
        console.log("   🚰 Alchemy Faucet: https://sepoliafaucet.com/");
        console.log("   🚰 Chainlink Faucet: https://faucets.chain.link/sepolia");
    }
    
    // Estimation des frais de gaz
    console.log("⛽ Estimation des frais de gaz...");
    const gasPrice = await deployer.provider.getGasPrice();
    const gasPriceGwei = hre.ethers.formatUnits(gasPrice, "gwei");
    console.log("   Prix du gaz:", gasPriceGwei, "Gwei");
    
    console.log("\n🚀 Déploiement du token THD...");
    
    // Déploiement THD Token avec plus de supply pour les tests
    const THDToken = await hre.ethers.getContractFactory("THDToken");
    const initialSupply = 1000000; // 1M THD pour tests
    
    console.log("📤 Envoi de la transaction...");
    const thdToken = await THDToken.deploy(initialSupply);
    
    console.log("⏳ Attente de confirmation...");
    await thdToken.waitForDeployment();
    
    const thdAddress = await thdToken.getAddress();
    console.log("✅ THD Token déployé à:", thdAddress);
    
    // Vérification du déploiement
    const deployedSupply = await thdToken.totalSupply();
    const formattedSupply = hre.ethers.formatEther(deployedSupply);
    console.log("🔍 Supply vérifiée:", formattedSupply, "THD");
    
    // Création d'adresses de test pour les utilisateurs
    console.log("\n👥 Génération d'adresses de test...");
    
    // Génère des wallets de test
    const testWallets = [];
    for (let i = 0; i < 5; i++) {
        const wallet = hre.ethers.Wallet.createRandom();
        testWallets.push({
            address: wallet.address,
            privateKey: wallet.privateKey,
            mnemonic: wallet.mnemonic.phrase
        });
        console.log(`   Wallet ${i + 1}: ${wallet.address}`);
    }
    
    // Distribution de tokens THD aux wallets de test
    console.log("\n💸 Distribution de THD aux wallets de test...");
    const distributionAmount = hre.ethers.parseEther("1000"); // 1000 THD chacun
    
    for (let i = 0; i < testWallets.length; i++) {
        const wallet = testWallets[i];
        try {
            const tx = await thdToken.transfer(wallet.address, distributionAmount);
            await tx.wait();
            console.log(`   ✅ ${wallet.address}: 1000 THD`);
        } catch (error) {
            console.log(`   ❌ ${wallet.address}: Échec - ${error.message}`);
        }
    }
    
    // Informations de déploiement
    const deploymentInfo = {
        network: "sepolia",
        chainId: 11155111,
        thdToken: thdAddress,
        deployer: deployer.address,
        deployedAt: new Date().toISOString(),
        gasPrice: gasPriceGwei,
        totalSupply: formattedSupply,
        rpcUrl: process.env.SEPOLIA_RPC_URL,
        explorer: {
            token: `https://sepolia.etherscan.io/token/${thdAddress}`,
            deployer: `https://sepolia.etherscan.io/address/${deployer.address}`
        },
        testWallets: testWallets,
        faucets: [
            "https://sepoliafaucet.com/",
            "https://faucets.chain.link/sepolia"
        ],
        instructions: {
            thunderd: `thunderd --rpc ${process.env.SEPOLIA_RPC_URL}`,
            importWallet: "thunder-cli importwallet \"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about\""
        }
    };
    
    // Sauvegarde des informations
    const deployDir = path.join(__dirname, "..", "deployments");
    if (!fs.existsSync(deployDir)) {
        fs.mkdirSync(deployDir);
    }
    
    const deploymentFile = path.join(deployDir, "sepolia.json");
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
    
    // Sauvegarde sécurisée des wallets de test
    const walletsFile = path.join(deployDir, "sepolia-test-wallets.json");
    fs.writeFileSync(walletsFile, JSON.stringify({
        network: "sepolia",
        wallets: testWallets,
        warning: "⚠️ Ces clés privées sont pour TESTS UNIQUEMENT sur Sepolia !",
        instructions: "Utilisez ces wallets pour tester Thunder avec vos amis"
    }, null, 2));
    
    console.log("\n🎉 DÉPLOIEMENT SEPOLIA TERMINÉ !");
    console.log("================================");
    console.log("📄 Token THD:", thdAddress);
    console.log("🔗 Explorer:", `https://sepolia.etherscan.io/token/${thdAddress}`);
    console.log("📁 Config sauvée:", deploymentFile);
    console.log("👥 Wallets test:", walletsFile);
    
    console.log("\n🚀 INSTRUCTIONS POUR LES UTILISATEURS:");
    console.log("=====================================");
    console.log("1. Télécharger les exécutables Thunder");
    console.log("2. Démarrer le node:");
    console.log(`   thunderd --rpc ${process.env.SEPOLIA_RPC_URL}`);
    console.log("3. Importer un wallet de test (voir sepolia-test-wallets.json)");
    console.log("4. Se connecter avec d'autres utilisateurs:");
    console.log("   thunder-cli connect <ip_publique>:2001");
    console.log("5. Créer des channels et faire des paiements !");
    
    console.log("\n💡 LIENS UTILES:");
    console.log("================");
    console.log("🚰 Faucet ETH Sepolia: https://sepoliafaucet.com/");
    console.log("🔍 Explorer Sepolia: https://sepolia.etherscan.io/");
    console.log("📚 Documentation: README.md");
    
    // Vérification automatique si possible
    if (process.env.ETHERSCAN_API_KEY) {
        console.log("\n🔍 Vérification du contrat sur Etherscan...");
        try {
            await hre.run("verify:verify", {
                address: thdAddress,
                constructorArguments: [initialSupply],
            });
            console.log("✅ Contrat vérifié sur Etherscan !");
        } catch (error) {
            console.log("⚠️  Vérification automatique échouée:", error.message);
            console.log("💡 Vous pouvez vérifier manuellement sur Etherscan");
        }
    }
    
    return deploymentInfo;
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error("❌ Erreur de déploiement:", error);
            process.exit(1);
        });
}

module.exports = main;