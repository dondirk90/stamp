const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const Stamp = await hre.ethers.getContractFactory("StampCard");
  const stamp = await Stamp.deploy();
  await stamp.waitForDeployment(); // ethers v6
  const address = await stamp.getAddress(); // ethers v6
  console.log("✅ StampCard deployed to:", address);
  // Update existing .env.local without clobbering other keys.
  const envPath = ".env.local";
  let env = {};
  try {
    if (fs.existsSync(envPath)) {
      const raw = fs.readFileSync(envPath, "utf8");
      raw.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^([^=]+)=(.*)$/);
        if (m) env[m[1]] = m[2];
      });
    }
  } catch (e) {
    // ignore read errors, we'll recreate the file
  }

  const networkName = (hre.network && hre.network.name) || "unknown";
  if (networkName === "sepolia") {
    env.SEPOLIA_STAMPCARD_ADDRESS = address;
  } else {
    env.STAMPCARD_ADDRESS = address;
  }

  const out =
    Object.keys(env)
      .map((k) => `${k}=${env[k]}`)
      .join("\n") + "\n";
  fs.writeFileSync(envPath, out, { flag: "w" });
  console.log("✅ Updated .env.local");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
