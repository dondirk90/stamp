const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
const { ethers } = require("ethers");

async function main() {
  const RPC = process.env.RPC_URL;
  const ADDR = process.env.STAMPCARD_ADDRESS;
  console.log("RPC_URL=", RPC ? "[redacted]" : null);
  console.log("STAMPCARD_ADDRESS=", ADDR || null);
  if (!RPC) {
    console.error("Missing RPC_URL in .env.local");
    process.exit(2);
  }
  const provider = new ethers.JsonRpcProvider(RPC);
  try {
    const bn = await provider.getBlockNumber();
    console.log("blockNumber=", bn);
  } catch (e) {
    console.error(
      "Could not get block number:",
      e && e.message ? e.message : e
    );
  }
  if (!ADDR) {
    console.error("No STAMPCARD_ADDRESS set");
    process.exit(0);
  }
  try {
    const code = await provider.getCode(ADDR);
    if (!code) console.log("getCode -> null/undefined");
    else console.log("code length:", code.length, "prefix:", code.slice(0, 80));
  } catch (e) {
    console.error("Error on getCode:", e && e.message ? e.message : e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
