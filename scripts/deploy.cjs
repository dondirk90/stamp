const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const Stamp = await hre.ethers.getContractFactory("StampCard");
  const stamp = await Stamp.deploy();
  await stamp.waitForDeployment(); // ethers v6
  const address = await stamp.getAddress(); // ethers v6
  console.log("✅ StampCard deployed to:", address);

  fs.writeFileSync(".env.local", `STAMPCARD_ADDRESS=${address}\n`, {
    flag: "w",
  });
  console.log("✅ Saved to .env.local");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
