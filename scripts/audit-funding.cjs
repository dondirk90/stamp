#!/usr/bin/env node
/**
 * Audit server wallet funding transfers (Sepolia via Alchemy)
 * - Lists outgoing native ETH transfers from server wallet
 * - Uses alchemy_getAssetTransfers for accurate history
 */

require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env.local"),
});
const { ethers } = require("ethers");

const RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
const PRIVATE_KEY =
  process.env.SEPOLIA_PRIVATE_KEY || process.env.CAFE_PRIVATE_KEY;

if (!RPC_URL || !PRIVATE_KEY) {
  console.error("❌ Missing RPC_URL or PRIVATE_KEY in .env.local");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const serverWallet = new ethers.Wallet(PRIVATE_KEY, provider);

async function main() {
  console.log("🔍 Auditing funding transfers for:");
  console.log("   Server Address:", serverWallet.address);

  const latest = await provider.getBlockNumber();
  // Query last ~10k blocks (~24h on Sepolia) — adjust if needed
  const fromBlock = "0x" + (latest - 10000).toString(16);
  const toBlock = "latest";

  const params = {
    fromBlock,
    toBlock,
    category: ["external"], // native value transfers
    withMetadata: true,
    excludeZeroValue: false,
    fromAddress: serverWallet.address,
    // maxCount: "0x64", // hex for 100
  };

  let transfers;
  try {
    transfers = await provider.send("alchemy_getAssetTransfers", [params]);
  } catch (e) {
    console.error("❌ alchemy_getAssetTransfers failed:", e.message || e);
    console.error("Ensure you're using an Alchemy RPC URL.");
    process.exit(1);
  }

  const list = (transfers && transfers.transfers) || [];
  if (list.length === 0) {
    console.log("No outgoing ETH transfers found in last ~10k blocks.");
    return;
  }

  console.log(`\nFound ${list.length} outgoing transfers:`);
  for (const t of list) {
    const when = new Date(t.metadata.blockTimestamp).toLocaleString();
    console.log(`- ${when}`);
    console.log(`  tx: ${t.hash}`);
    console.log(`  to: ${t.to}`);
    console.log(`  value: ${t.value} ETH`);
    console.log(`  block: ${t.blockNum}`);
  }
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
