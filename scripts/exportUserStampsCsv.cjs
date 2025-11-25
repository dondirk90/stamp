const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
const fs = require("fs");
const Database = require("better-sqlite3");
const { ethers } = require("ethers");

const dbPath = path.join(__dirname, "..", "data", "stamps.db");
const outPath = path.join(__dirname, "..", "data", "user_stamps.csv");

const db = new Database(dbPath, { readonly: true });
const users = db
  .prepare(
    "SELECT user, COUNT(*) as events FROM stamp_events GROUP BY user ORDER BY events DESC"
  )
  .all();

const RPC = process.env.RPC_URL;
const PRIVATE_KEY = process.env.CAFE_PRIVATE_KEY;
const STAMPCARD = process.env.STAMPCARD_ADDRESS;
if (!RPC) {
  console.error("Missing RPC_URL");
  process.exit(2);
}
if (!STAMPCARD) {
  console.error("Missing STAMPCARD_ADDRESS");
  process.exit(2);
}

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = PRIVATE_KEY ? new ethers.Wallet(PRIVATE_KEY, provider) : null;
const stampCardJson = require("../artifacts/contracts/StampCard.sol/StampCard.json");
const contract = new ethers.Contract(
  STAMPCARD,
  stampCardJson.abi,
  wallet || provider
);

function normalize(v) {
  try {
    if (typeof v === "bigint") return Number(v);
    if (v && typeof v.toNumber === "function") return v.toNumber();
    return Number(v);
  } catch (e) {
    return String(v);
  }
}

(async () => {
  const lines = ["user,events_count,onchain_stamps"];
  for (const row of users) {
    const user = row.user;
    const events = row.events;
    let onchain = "";
    try {
      const cnt = await contract.getStamps(
        wallet ? wallet.address : ethers.ZeroAddress,
        user
      );
      onchain = normalize(cnt);
    } catch (e) {
      onchain = `ERROR:${e && e.message ? e.message.replace(/\n/g, " ") : e}`;
    }
    lines.push(`${user},${events},${onchain}`);
  }
  fs.writeFileSync(outPath, lines.join("\n"));
  console.log("Wrote", outPath, "rows=", users.length);
})();
