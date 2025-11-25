import { STAMPCARD_ADDRESS, DEFAULT_CHAIN_ID } from "./constants";

export const domain = {
  name: "StampCard",
  version: "1",
  chainId: DEFAULT_CHAIN_ID,
  verifyingContract: STAMPCARD_ADDRESS,
} as const;

export const types = {
  StampRequest: [
    { name: "cafeId", type: "bytes16" },
    { name: "nonce", type: "bytes32" },
    { name: "expires", type: "uint256" },
    { name: "customer", type: "address" },
  ],
} as const;

export type StampRequest = {
  cafeId: `0x${string}`; // 16 bytes hex
  nonce: `0x${string}`; // 32 bytes hex
  expires: bigint; // unix seconds
  customer: `0x${string}`;
};
