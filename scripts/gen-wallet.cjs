#!/usr/bin/env node
/**
 * Simple Sepolia wallet generator.
 * Prints: address, private key, mnemonic phrase, Hardhat import snippet.
 * NEVER commit the generated private key or mnemonic.
 */

const { ethers } = require("ethers");

function banner(msg) {
  console.log("\n=== " + msg + " ===\n");
}

function main() {
  banner("Generating new wallet (mnemonic + private key)");
  const wallet = ethers.Wallet.createRandom();

  console.log("Address:        ", wallet.address);
  console.log("Private Key:    ", wallet.privateKey);
  if (wallet.mnemonic) {
    console.log("Mnemonic (12w): ", wallet.mnemonic.phrase);
  } else {
    console.log("Mnemonic:       (not available)");
  }

  banner("Environment lines to copy into .env.local");
  console.log("SEPOLIA_PRIVATE_KEY=" + wallet.privateKey);
  console.log(
    "CAFE_PRIVATE_KEY=" +
      wallet.privateKey +
      "  # optional: use same or create separate cafe key"
  );

  banner("Hardhat network reminder");
  console.log(
    "Ensure hardhat.config.cjs has networks.sepolia.accounts set via process.env.SEPOLIA_PRIVATE_KEY"
  );

  banner("Security advice");
  console.log("1. Store mnemonic in a password manager or offline note.");
  console.log("2. NEVER push .env.local or this output to Git.");
  console.log("3. If compromised: generate a new wallet and migrate funds.");
  console.log(
    "4. For production: consider a separate deployer key (do not reuse application key)."
  );

  banner("Quick test");
  console.log(
    "After updating .env.local run: npx hardhat run scripts/deploy.cjs --network sepolia"
  );
}

main();
