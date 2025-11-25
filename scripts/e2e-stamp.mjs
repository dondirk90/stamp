// scripts/e2e-stamp.mjs
import { Wallet } from "ethers";

// ---- Konfig ----
const API_BASE = process.env.API_BASE || "http://127.0.0.1:3000";
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
const STAMPCARD_ADDRESS =
  process.env.STAMPCARD_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";

// Nimm NICHT das Café-Key aus .env.local, sondern einen anderen Hardhat-Account!
const CUSTOMER_PRIVATE_KEY = process.env.CUSTOMER_PRIVATE_KEY;
if (!CUSTOMER_PRIVATE_KEY) {
  console.error(
    "Bitte setze CUSTOMER_PRIVATE_KEY (Hardhat-Konto, NICHT das Café-Key)."
  );
  process.exit(1);
}

const domain = {
  name: "StampCard",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: STAMPCARD_ADDRESS,
};
const types = {
  StampRequest: [
    { name: "cafeId", type: "bytes16" },
    { name: "nonce", type: "bytes32" },
    { name: "expires", type: "uint256" },
    { name: "customer", type: "address" },
  ],
};

async function main() {
  // 1) QR/Issue vom Server holen (simuliert Café-App)
  const issueRes = await fetch(`${API_BASE}/qr/issue`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "x-api-key": "supersecret-dev-key"
    },
    body: JSON.stringify({ ttl: 60 }),
  });
  if (!issueRes.ok) {
    const t = await issueRes.text();
    throw new Error(`/qr/issue failed: ${issueRes.status} ${t}`);
  }
  const { cafeId, nonce, expires } = await issueRes.json();
  console.log("QR issued:", { cafeId, nonce, expires });

  // 2) Kunde signiert EIP-712
  const wallet = new Wallet(CUSTOMER_PRIVATE_KEY);
  const payload = {
    cafeId,
    nonce,
    expires: BigInt(expires),
    customer: wallet.address,
  };
  const signature = await wallet.signTypedData(domain, types, payload);
  console.log("Customer address:", wallet.address);
  console.log("Signature:", signature);

  // 3) /stamp aufrufen (Server validiert & ruft Contract)
  const stampRes = await fetch(`${API_BASE}/stamp`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "x-api-key": "supersecret-dev-key"
    },
    body: JSON.stringify({
      cafeId,
      nonce,
      expires,
      customer: wallet.address,
      signature,
    }),
  });
  const stampJson = await stampRes.json();
  if (!stampRes.ok) {
    throw new Error(
      `/stamp failed: ${stampRes.status} ${JSON.stringify(stampJson)}`
    );
  }
  console.log("Stamp TX:", stampJson);

  // 4) Check: Zähler lesen
  const countRes = await fetch(`${API_BASE}/stamps/${wallet.address}`);
  const countJson = await countRes.json();
  console.log("Current stamp count:", countJson);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
