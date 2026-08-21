import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";

// ---------------------------------------------------------------------------
// Net extraction via union-find (disjoint-set).
//
// A "pin endpoint" is `${nodeId}:${pinId}`. Two endpoints joined by a wire
// belong to the same electrical net. Every ground pin is forced into net "0".
// TIP nodes are transparent joiners (union through them) but do not mint nets.
// ---------------------------------------------------------------------------

class DSU {
  private parent = new Map<string, string>();

  private find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  add(x: string): void {
    this.find(x);
  }

  root(x: string): string {
    return this.find(x);
  }
}

export interface NetMap {
  netOf: (nodeId: string, pinId: string) => string;
  nets: string[];
}

const ep = (nodeId: string, pinId: string) => `${nodeId}:${pinId}`;

export function extractNets(
  nodes: Node<ComponentData>[],
  edges: Edge[],
): NetMap {
  const dsu = new DSU();
  const groundEndpoints: string[] = [];

  // 1. Register pins. TIP pins are included so wires through tips still union.
  for (const node of nodes) {
    const spec = COMPONENT_SPECS[node.data.kind];
    for (const pin of spec.pins) {
      const e = ep(node.id, pin.id);
      dsu.add(e);
      if (node.data.kind === "GND") groundEndpoints.push(e);
    }
  }

  // 2. Union endpoints joined by wires (tips act as solder blobs).
  for (const edge of edges) {
    if (!edge.sourceHandle || !edge.targetHandle) continue;
    dsu.union(ep(edge.source, edge.sourceHandle), ep(edge.target, edge.targetHandle));
  }

  // 3. Collapse every GND pin into one net, then name that root "0".
  for (let i = 1; i < groundEndpoints.length; i++) {
    dsu.union(groundEndpoints[0]!, groundEndpoints[i]!);
  }
  const groundRoot = groundEndpoints.length ? dsu.root(groundEndpoints[0]!) : null;

  const nameByRoot = new Map<string, string>();
  const order: string[] = [];
  if (groundRoot) {
    nameByRoot.set(groundRoot, "0");
    order.push("0");
  }

  // 4. Net-label (NODE) elements force their group's name.
  for (const node of nodes) {
    if (node.data.kind !== "NODE") continue;
    const pinId = COMPONENT_SPECS.NODE.pins[0]!.id;
    const root = dsu.root(ep(node.id, pinId));
    if (nameByRoot.has(root)) continue;
    const raw = (node.data.params.name ?? "").trim();
    const name = raw.replace(/\s+/g, "_");
    if (name) {
      nameByRoot.set(root, name);
      order.push(name);
    }
  }

  let next = 1;
  const nameFor = (root: string): string => {
    let name = nameByRoot.get(root);
    if (name === undefined) {
      name = String(next++);
      nameByRoot.set(root, name);
      order.push(name);
    }
    return name;
  };

  // 5. Only mint net numbers for pins that matter electrically — not TIP-only
  //    orphans. Emitting devices + GND + NODE + probes define the netlist.
  for (const node of nodes) {
    if (node.data.kind === "TIP") continue;
    const spec = COMPONENT_SPECS[node.data.kind];
    for (const pin of spec.pins) nameFor(dsu.root(ep(node.id, pin.id)));
  }

  return {
    netOf: (nodeId, pinId) => nameFor(dsu.root(ep(nodeId, pinId))),
    nets: order,
  };
}
