import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { GenLayerClient } from "genlayer-js/types";

// Default placeholder contract address on GenLayer Studionet.
// Will be overridden by the deployer's contract address.
export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
  "0x1d4c3b281FE4d4EAa61cA3AC08AF2a994e83174D") as `0x${string}`;

declare global {
  interface Window {
    ethereum?: any;
  }
}

export type WalletState = {
  address: `0x${string}` | null;
  client: GenLayerClient<any> | null;
};

// GenLayer Studio Network RPC configuration for MetaMask/Rabby integration
const STUDIONET_PARAMS = {
  chainId: "0xF22F", // 61999 in decimal
  chainName: "GenLayer Studio Network",
  nativeCurrency: {
    name: "GEN Token",
    symbol: "GEN",
    decimals: 18,
  },
  rpcUrls: ["https://studio.genlayer.com/api"],
  blockExplorerUrls: ["https://genlayer-explorer.vercel.app"],
};

/**
 * Checks if the browser has an EVM-compatible wallet injected.
 */
export function hasWallet(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

/**
 * Connects the user's EVM wallet and automatically requests network switch
 * to GenLayer Studio Network.
 */
export async function connectWallet(): Promise<WalletState> {
  if (!hasWallet()) {
    throw new Error("No EVM wallet found. Please install MetaMask, Rabby, or another wallet extension.");
  }

  // Request account authorization
  const accounts: string[] = await window.ethereum.request({
    method: "eth_requestAccounts",
  });
  if (!accounts || accounts.length === 0) {
    throw new Error("Connection request rejected by user.");
  }
  const address = accounts[0] as `0x${string}`;

  // Tries to switch to GenLayer network, or adds it if unrecognized
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET_PARAMS.chainId }],
    });
  } catch (switchError: any) {
    if (switchError?.code === 4902 || /unrecognized/i.test(switchError?.message || "")) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [STUDIONET_PARAMS],
        });
      } catch (addError: any) {
        throw new Error(`Failed to add GenLayer Network to wallet: ${addError.message}`);
      }
    } else if (switchError?.code !== 4001) {
      // Ignore minor error codes to proceed with signing attempt
    } else {
      throw switchError;
    }
  }

  // Instantiate the client with chain, account, and window provider
  const client = createClient({
    chain: studionet,
    account: address,
    provider: window.ethereum,
  } as any);

  return { address, client };
}

/**
 * Creates a read-only client for fetching contract state.
 */
export function readClient(): GenLayerClient<any> {
  return createClient({ chain: studionet }) as GenLayerClient<any>;
}

/**
 * Resets wallet connection state.
 */
export function disconnectWallet(): WalletState {
  return { address: null, client: null };
}

/**
 * Utility to truncate EVM addresses for display.
 */
export function shortAddr(addr: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
