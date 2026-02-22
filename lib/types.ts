export interface TokenInfo {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
}

export interface TransferTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  tokenSymbol: string;
  tokenName: string;
  tokenDecimal: string;
  contractAddress: string;
}

export interface GraphNode {
  id: string;
  address: string;
  isTarget: boolean;
  isContract: boolean;
  label: string | null;
  txCount: number;
  volIn: number;
  volOut: number;
  balance: number | null;
  netPosition: number | null;
  firstSeen: number;
  lastSeen: number;
}

export interface GraphLink {
  source: string;
  target: string;
  value: number;
  txCount: number;
  direction: 'sent' | 'received';
}

export interface ScanResult {
  nodes: GraphNode[];
  links: GraphLink[];
  transfers: TransferTx[];
  detectedContracts: string[];
  balances: Record<string, number>;
  fundingSources?: Record<string, string>;
}

export type TokenOrigin = 'from-target' | 'from-dex' | 'from-third-party' | 'mixed' | 'unknown';

export interface HiddenHoldingWallet {
  address: string;
  balance: number;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  fundingSource: string | null;
  firstInteraction: number;
  lastInteraction: number;
  transfersWithTarget: number;
  netFlowFromTarget: number;
  tokenOrigin: TokenOrigin;
  tokenOriginDetails: string;
}

export interface OutboundSummary {
  toDex: { amount: number; percentage: number; txCount: number };
  toWallets: { amount: number; percentage: number; txCount: number };
  toContracts: { amount: number; percentage: number; txCount: number };
  topRecipients: { address: string; amount: number; stillHolding: number }[];
}

export interface HoldingsReport {
  targetWallet: string;
  targetBalance: number;
  totalHeldByCluster: number;
  totalPossibleHidden: number;
  wallets: HiddenHoldingWallet[];
  clusterSummary: string;
  riskFlags: string[];
  outboundSummary: OutboundSummary;
}
