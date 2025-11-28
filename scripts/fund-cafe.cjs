const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
const { ethers } = require("ethers");

async function fundCafe() {
  try {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

    // Hardhat Account #0 (has 10000 ETH)
    const funderKey =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const funder = new ethers.Wallet(funderKey, provider);

    // Café wallet address from recreate-cafe output
    const cafeAddress = "0xD5a0D7b215F04cAA21ae15f90B1ddCBAE2CC41d6";

    console.log(`Funding café wallet: ${cafeAddress}`);
    console.log(`From funder: ${funder.address}`);

    // Send 10 ETH to café wallet
    const tx = await funder.sendTransaction({
      to: cafeAddress,
      value: ethers.parseEther("10.0"),
    });

    console.log(`Transaction sent: ${tx.hash}`);
    console.log("Waiting for confirmation...");

    await tx.wait();

    console.log("✅ Transaction confirmed!");

    // Check balance
    const balance = await provider.getBalance(cafeAddress);
    console.log(`\nCafé wallet balance: ${ethers.formatEther(balance)} ETH`);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

fundCafe();
