import hre from "hardhat";

async function main() {
  console.log("hre 키 목록:", Object.keys(hre));
  console.log("hre.viem:", hre.viem);
  console.log("hre.ethers:", hre.ethers);
}

main().catch(console.error);