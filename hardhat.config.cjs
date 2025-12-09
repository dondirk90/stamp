require("@nomicfoundation/hardhat-toolbox");
// Load env from .env.local (API server uses this); fallback to .env
try {
  const fs = require("fs");
  const path = require("path");
  const dotenv = require("dotenv");
  const localPath = path.resolve(__dirname, ".env.local");
  if (fs.existsSync(localPath)) {
    dotenv.config({ path: localPath });
  } else {
    dotenv.config();
  }
} catch {}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || process.env.RPC_URL || "",
      accounts: (() => {
        const pk =
          process.env.SEPOLIA_PRIVATE_KEY || process.env.CAFE_PRIVATE_KEY || "";
        return pk && pk.startsWith("0x") ? [pk] : [];
      })(),
      chainId: 11155111,
    },
  },
};
