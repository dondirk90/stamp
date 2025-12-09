#!/usr/bin/env node
/**
 * Check balance of server wallet and all café wallets
 */

require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env.local"),
});
const { ethers } = require("ethers");
const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
const PRIVATE_KEY =
  process.env.SEPOLIA_PRIVATE_KEY || process.env.CAFE_PRIVATE_KEY;

if (!RPC_URL || !PRIVATE_KEY) {
  console.error("❌ Missing RPC_URL or PRIVATE_KEY in .env.local");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);

// Decrypt helper
function decryptPrivateKey(dataB64) {
  const key = Buffer.from(process.env.MASTER_KEY, "hex");
  const buf = Buffer.from(dataB64, "base64");
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const ct = buf.slice(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString("utf8");
}

async function main() {
  // Check server wallet
  const serverWallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const serverBalance = await provider.getBalance(serverWallet.address);

  console.log("\n💰 Server Wallet:");
  console.log(`   Address: ${serverWallet.address}`);
  console.log(`   Balance: ${ethers.formatEther(serverBalance)} ETH`);

  if (serverBalance === 0n) {
    console.log(
      "   ⚠️  WARNING: Server wallet has NO ETH! Cannot auto-fund cafés."
    );
    console.log(
      "   🚰 Get Sepolia ETH from: https://www.alchemy.com/faucets/ethereum-sepolia"
    );
  } else if (serverBalance < ethers.parseEther("0.01")) {
    console.log("   ⚠️  WARNING: Server wallet balance is low!");
  }

  // Check café wallets
  const db = new Database(path.join(__dirname, "../data/stamps.db"));
  const cafes = db
    .prepare("SELECT id, name, address, encrypted_key FROM cafes")
    .all();

  console.log(`\n☕ Café Wallets (${cafes.length}):`);

  for (const cafe of cafes) {
    let balance = 0n;
    let address = cafe.address;

    // Try to get address from encrypted key if not stored
    if (!address && cafe.encrypted_key) {
      try {
        const privKey = decryptPrivateKey(cafe.encrypted_key);
        const wallet = new ethers.Wallet(privKey);
        address = wallet.address;
      } catch (e) {
        console.log(`   ❌ ${cafe.name}: Could not decrypt wallet`);
        continue;
      }
    }

    if (address) {
      balance = await provider.getBalance(address);
      const ethBalance = ethers.formatEther(balance);
      const status =
        balance === 0n
          ? "❌ EMPTY"
          : balance < ethers.parseEther("0.005")
          ? "⚠️  LOW"
          : "✅";
      console.log(`   ${status} ${cafe.name || "Unnamed"}`);
      console.log(`      Address: ${address}`);
      console.log(`      Balance: ${ethBalance} ETH`);
    } else {
      console.log(`   ❓ ${cafe.name || "Unnamed"}: No address available`);
    }
  }

  db.close();

  console.log("\n💡 Next steps:");
  if (serverBalance === 0n) {
    console.log("   1. Fund server wallet with Sepolia ETH from faucet");
    console.log(
      "   2. Server will then auto-fund café wallets when they stamp"
    );
  } else if (serverBalance > 0n) {
    console.log("   ✅ Server wallet has ETH and can auto-fund cafés");
  }
}

main().catch(console.error);
