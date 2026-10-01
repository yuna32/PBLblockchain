import { defineConfig } from "hardhat/config";
import hardhatViem from "@nomicfoundation/hardhat-viem";

export default defineConfig({
  plugins: [hardhatViem],
  solidity: "0.8.20",
  paths: {
    sources: "./contracts",
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
      allowBlocksWithSameTimestamp: true,
      mining: {
        auto: false,
        interval: 0
      }
    }
  }
});