export const HARDHAT_CHAIN_ID = 31337 as const;
export const DEFAULT_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_CHAIN_ID ?? HARDHAT_CHAIN_ID
);
export const STAMPCARD_ADDRESS =
  process.env.NEXT_PUBLIC_STAMPCARD_ADDRESS ||
  process.env.STAMPCARD_ADDRESS ||
  "0x5FbDB2315678afecb367f032d93F642f64180aa3";
