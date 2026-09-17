/**
 * Section 05 "Sybil lobby" mitigation: wallet/funding-source clustering.
 *
 * A union-find over observed links between wallets — funded from the same
 * source, sharing a device fingerprint, sharing an IP at signup, etc. Two
 * wallets end up in the same cluster if there's a chain of such links
 * between them, even if no single link directly connects them.
 */
export type LinkReason = "funded_by" | "shared_device" | "shared_ip";

export interface LinkEdge {
  a: string;
  b: string;
  reason: LinkReason;
}

export class WalletClusterGraph {
  private parent = new Map<string, string>();

  private find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;

    // Path compression so repeated lookups on a large graph stay cheap.
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }

  addEdges(edges: LinkEdge[]): void {
    for (const edge of edges) this.union(edge.a, edge.b);
  }

  areLinked(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }

  clusterRootOf(wallet: string): string {
    return this.find(wallet);
  }
}

/** A lobby whose two sides land in the same wallet cluster is a suspected sybil match. */
export function isSuspectedSybilMatch(graph: WalletClusterGraph, creator: string, opponent: string): boolean {
  return graph.areLinked(creator, opponent);
}
