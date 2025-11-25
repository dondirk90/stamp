#!/usr/bin/env node
const { Wallet } = require("ethers");
const fs = require("fs");
const path = require("path");

function usage() {
  console.log(`Usage: node scripts/sign-and-submit.cjs --cafeId <hex16> --nonce <hex32> --expires <unix> --privateKey <0x...> [--api http://127.0.0.1:3000]

Example:
  node scripts/sign-and-submit.cjs --cafeId 0xabc... --nonce 0xdef... --expires 1762716108 --privateKey 0x59c6... --api http://127.0.0.1:3000
`);
}

// Parse CLI args but force certain options to remain strings to avoid numeric coercion
const argv = require("minimist")(process.argv.slice(2), {
  string: ["cafeId", "nonce", "privateKey"],
});
if (argv.h || argv.help) {
  usage();
  process.exit(0);
}
const cafeId = argv.cafeId || argv.cafeid;
const nonce = argv.nonce;
const expires = argv.expires;
const privateKey =
  argv.privateKey || argv.key || process.env.CUSTOMER_PRIVATE_KEY;
const apiBase = argv.api || process.env.API_BASE || "http://127.0.0.1:3000";

if (!cafeId || !nonce || !expires || !privateKey) {
  usage();
  process.exit(2);
}

(async () => {
  try {
    const wallet = new Wallet(privateKey);

    const domain = {
      name: "StampCard",
      version: "1",
      chainId: Number(process.env.CHAIN_ID || 31337),
      verifyingContract:
        process.env.STAMPCARD_ADDRESS ||
        "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    };

    const types = {
      StampRequest: [
        { name: "cafeId", type: "bytes16" },
        { name: "nonce", type: "bytes32" },
        { name: "expires", type: "uint256" },
        { name: "customer", type: "address" },
      ],
    };

    const message = {
      cafeId: cafeId,
      nonce: nonce,
      expires: BigInt(expires),
      customer: wallet.address,
    };

    console.log("Signing message for", wallet.address);
    // ethers v6: wallet.signTypedData(domain, types, message)
    const signature = await wallet.signTypedData(domain, types, message);
    console.log("Signature:", signature);

    const payload = {
      cafeId,
      nonce,
      expires: Number(expires),
      customer: wallet.address,
      signature,
    };

    // POST to API
    const url = apiBase.replace(/\/$/, "") + "/stamp";
    console.log("Posting to", url);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    try {
      console.log("Response:", JSON.stringify(JSON.parse(text), null, 2));
    } catch (e) {
      console.log("Response text:", text);
    }
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
})();
