import { ethers } from "ethers";
import abiJson from "./abi/StampCard.json" assert { type: "json" };
import { STAMPCARD_ADDRESS } from "./constants";

export const stampAbi = abiJson.abi as any[];

export function getContract(providerOrSigner: ethers.Provider | ethers.Signer) {
  return new ethers.Contract(STAMPCARD_ADDRESS, stampAbi, providerOrSigner);
}

export async function getStampCount(
  provider: ethers.Provider,
  user: string
): Promise<bigint> {
  const c = getContract(provider);
  const count: bigint = await c.stampCount(user);
  return count;
}
