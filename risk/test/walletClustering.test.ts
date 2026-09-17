import { describe, it, expect } from "vitest";
import { WalletClusterGraph, isSuspectedSybilMatch } from "../src/walletClustering.js";
import type { LinkEdge, LinkReason } from "../src/walletClustering.js";

describe("WalletClusterGraph", () => {
  it("treats two directly-linked wallets as the same cluster", () => {
    const graph = new WalletClusterGraph();
    graph.addEdges([{ a: "0xA", b: "0xB", reason: "funded_by" }]);
    expect(graph.areLinked("0xA", "0xB")).toBe(true);
  });

  it("treats unlinked wallets as separate clusters", () => {
    const graph = new WalletClusterGraph();
    graph.addEdges([{ a: "0xA", b: "0xB", reason: "funded_by" }]);
    expect(graph.areLinked("0xA", "0xC")).toBe(false);
  });

  it("transitively links wallets through a chain of edges", () => {
    const graph = new WalletClusterGraph();
    // A funded B, B shares a device with C -- A and C never directly interacted.
    graph.addEdges([
      { a: "0xA", b: "0xB", reason: "funded_by" },
      { a: "0xB", b: "0xC", reason: "shared_device" },
    ]);
    expect(graph.areLinked("0xA", "0xC")).toBe(true);
  });

  it("merges two previously-separate clusters when a bridging edge appears", () => {
    const graph = new WalletClusterGraph();
    graph.addEdges([
      { a: "0xA", b: "0xB", reason: "funded_by" },
      { a: "0xC", b: "0xD", reason: "shared_ip" },
    ]);
    expect(graph.areLinked("0xA", "0xD")).toBe(false);

    graph.addEdges([{ a: "0xB", b: "0xC", reason: "shared_device" }]);
    expect(graph.areLinked("0xA", "0xD")).toBe(true);
  });
});

describe("isSuspectedSybilMatch", () => {
  it("flags a duel between two wallets in the same cluster", () => {
    const graph = new WalletClusterGraph();
    graph.addEdges([{ a: "0xCreator", b: "0xOpponent", reason: "funded_by" }]);
    expect(isSuspectedSybilMatch(graph, "0xCreator", "0xOpponent")).toBe(true);
  });

  it("does not flag a duel between genuinely unrelated wallets", () => {
    const graph = new WalletClusterGraph();
    graph.addEdges([{ a: "0xCreator", b: "0xSomeoneUnrelated", reason: "funded_by" }]);
    expect(isSuspectedSybilMatch(graph, "0xCreator", "0xOpponent")).toBe(false);
  });

  // INTENDED per README ("Two wallets end up in the same cluster if there's a
  // chain of such links between them, even if no single link directly
  // connects them") and the walletClustering.ts module comment: a hop through
  // an *intermediate* wallet on a *different* signal is deliberately enough
  // to flag a match, not just a direct shared signal between the two duel
  // participants. This pins that intentional multi-hop, mixed-reason
  // transitivity at the isSuspectedSybilMatch level (the existing
  // WalletClusterGraph describe block only checked it via areLinked).
  it("flags a duel where creator and opponent are linked transitively through a different-signal intermediate wallet (intentional per README)", () => {
    const graph = new WalletClusterGraph();
    // Creator shares an IP with a third wallet; that third wallet shares a
    // device with the opponent. Creator and opponent never share a signal
    // directly, yet the union-find still lands them in one cluster.
    graph.addEdges([
      { a: "0xCreator", b: "0xMule", reason: "shared_ip" },
      { a: "0xMule", b: "0xOpponent", reason: "shared_device" },
    ]);
    expect(isSuspectedSybilMatch(graph, "0xCreator", "0xOpponent")).toBe(true);
  });

  // Control case: two wallets that never appear in any edge at all (not even
  // indirectly) must never be flagged. Distinct from the "does not flag ...
  // genuinely unrelated wallets" test above, which still has the opponent
  // sharing a signal with someone else -- here neither wallet has any signal
  // on record whatsoever.
  it("does not flag two wallets that share no signal at all, directly or transitively", () => {
    const graph = new WalletClusterGraph();
    graph.addEdges([
      { a: "0xSomeoneElse1", b: "0xSomeoneElse2", reason: "shared_ip" },
      { a: "0xSomeoneElse3", b: "0xSomeoneElse4", reason: "funded_by" },
    ]);
    expect(isSuspectedSybilMatch(graph, "0xCreator", "0xOpponent")).toBe(false);
  });

  it("does not flag two wallets in a graph with no edges added at all", () => {
    const graph = new WalletClusterGraph();
    expect(isSuspectedSybilMatch(graph, "0xCreator", "0xOpponent")).toBe(false);
  });
});

describe("WalletClusterGraph property test (fuzz)", () => {
  // Reference implementation: plain BFS over an adjacency list built from the
  // same edge list, used as an oracle to check the union-find's areLinked()
  // against ground-truth graph connectivity across many random graphs.
  function bfsConnectedComponents(nodes: string[], edges: Array<[string, string]>): Map<string, number> {
    const adjacency = new Map<string, string[]>();
    for (const node of nodes) adjacency.set(node, []);
    for (const [a, b] of edges) {
      adjacency.get(a)!.push(b);
      adjacency.get(b)!.push(a);
    }
    const componentOf = new Map<string, number>();
    let nextComponent = 0;
    for (const start of nodes) {
      if (componentOf.has(start)) continue;
      const queue = [start];
      componentOf.set(start, nextComponent);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const neighbor of adjacency.get(cur)!) {
          if (!componentOf.has(neighbor)) {
            componentOf.set(neighbor, nextComponent);
            queue.push(neighbor);
          }
        }
      }
      nextComponent++;
    }
    return componentOf;
  }

  it("areLinked() agrees with BFS ground-truth connectivity on random graphs", () => {
    const reasons: LinkReason[] = ["funded_by", "shared_device", "shared_ip"];
    const NODE_COUNT = 12;
    const nodes = Array.from({ length: NODE_COUNT }, (_, i) => `0xNode${i}`);

    for (let trial = 0; trial < 200; trial++) {
      const edgeCount = Math.floor(Math.random() * 15);
      const edgePairs: Array<[string, string]> = [];
      const linkEdges: LinkEdge[] = [];
      for (let e = 0; e < edgeCount; e++) {
        const a = nodes[Math.floor(Math.random() * NODE_COUNT)];
        const b = nodes[Math.floor(Math.random() * NODE_COUNT)];
        const reason = reasons[Math.floor(Math.random() * reasons.length)];
        edgePairs.push([a, b]);
        linkEdges.push({ a, b, reason });
      }

      const graph = new WalletClusterGraph();
      graph.addEdges(linkEdges);
      const expectedComponents = bfsConnectedComponents(nodes, edgePairs);

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const expectedLinked = expectedComponents.get(nodes[i]) === expectedComponents.get(nodes[j]);
          expect(graph.areLinked(nodes[i], nodes[j])).toBe(expectedLinked);
        }
      }
    }
  });

  it("areLinked() is reflexive and symmetric for arbitrary wallets", () => {
    for (let trial = 0; trial < 50; trial++) {
      const graph = new WalletClusterGraph();
      const a = `0xA${Math.floor(Math.random() * 5)}`;
      const b = `0xB${Math.floor(Math.random() * 5)}`;
      if (Math.random() > 0.5) graph.addEdges([{ a, b, reason: "shared_ip" }]);

      expect(graph.areLinked(a, a)).toBe(true);
      expect(graph.areLinked(a, b)).toBe(graph.areLinked(b, a));
    }
  });
});
