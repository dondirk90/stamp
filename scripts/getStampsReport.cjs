const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
const { ethers } = require("ethers");
const Database = require("better-sqlite3");

const RPC = process.env.RPC_URL;
const PRIVATE_KEY = process.env.CAFE_PRIVATE_KEY;
const STAMPCARD = process.env.STAMPCARD_ADDRESS;

if (!RPC) {
  console.error("Missing RPC_URL in .env.local");
  process.exit(2);
}
if (!STAMPCARD) {
  console.error("Missing STAMPCARD_ADDRESS in .env.local");
  process.exit(2);
}

const db = new Database(path.join(__dirname, "..", "data", "stamps.db"), {
  readonly: true,
});
const users = db
  .prepare("SELECT DISTINCT user FROM stamp_events")
  .all()
  .map((r) => r.user);

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = PRIVATE_KEY ? new ethers.Wallet(PRIVATE_KEY, provider) : null;
const stampCardJson = require("../artifacts/contracts/StampCard.sol/StampCard.json");
const contract = new ethers.Contract(
  STAMPCARD,
  stampCardJson.abi,
  wallet || provider
);

function normalizeCount(v) {
  try {
    if (typeof v === "bigint") return Number(v);
    if (v && typeof v.toNumber === "function") return v.toNumber();
    return Number(v);
  } catch (e) {
    return String(v);
  }
}

(async () => {
  console.log("Stamp counts (on-chain) report");
  console.log("RPC:", RPC);
  console.log("Contract:", STAMPCARD);
  console.log("---");
  for (const u of users) {
    try {
      const cnt = await contract.getStamps(
        wallet ? wallet.address : ethers.ZeroAddress,
        u
      );
      const n = normalizeCount(cnt);
      console.log(`${u}\t${n}`);
    } catch (e) {
      console.error(`${u}\tERROR\t${e && e.message ? e.message : e}`);
    }
  }
})();
