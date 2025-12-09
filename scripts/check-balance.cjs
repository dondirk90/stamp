#!/usr/bin/env node
/**
 * Check Sepolia balance for the deployer wallet.
 */
const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const address = await signer.getAddress();
  const balance = await hre.ethers.provider.getBalance(address);

  console.log("\n=== Sepolia Wallet Status ===");
  console.log("Address:", address);
  console.log("Balance:", hre.ethers.formatEther(balance), "ETH");
  console.log("Balance (wei):", balance.toString());

  if (balance === 0n) {
    console.log("\n⚠️  No ETH! Get some from a faucet:");
    console.log("  - https://www.alchemy.com/faucets/ethereum-sepolia");
    console.log("  - https://sepolia-faucet.pk910.de/");
  } else if (balance < hre.ethers.parseEther("0.01")) {
    console.log("\n⚠️  Low balance. Recommend getting more from faucet.");
  } else {
    console.log("\n✅ Sufficient balance for deployment!");
  }
  console.log("================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
