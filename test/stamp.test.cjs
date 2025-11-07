const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StampCard (smoke)", function () {
  it("adds stamps per cafe->user", async function () {
    const [cafe, user, otherCafe] = await ethers.getSigners();
    const Stamp = await ethers.getContractFactory("StampCard");
    const stamp = await Stamp.deploy();
    await stamp.waitForDeployment();

    await (await stamp.connect(cafe).addStamp(user.address)).wait();
    await (await stamp.connect(cafe).addStamp(user.address)).wait();
    await (await stamp.connect(otherCafe).addStamp(user.address)).wait();

    const two = await stamp.getStamps(cafe.address, user.address);
    const one = await stamp.getStamps(otherCafe.address, user.address);
    expect(two).to.equal(2n);
    expect(one).to.equal(1n);
  });
});
