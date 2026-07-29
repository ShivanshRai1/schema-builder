import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";

// ---------------------------------------------------------------------------
// Net extraction via union-find (disjoint-set).
//
// A "pin endpoint" is `${nodeId}:${pinId}`. Two endpoints joined by a wire
// belong to the same electrical net. Every ground pin is forced into net "0".
// Every remaining connected group gets a stable small integer name.
//
// This is the heart of graph -> netlist: it is what turns geometry-free
// connectivity into the nets a SPICE line references.
// ---------------------------------------------------------------------------

class DSU {
  private parent = new Map<string, string>();

  private find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // path compression
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
  /** Net name for a given pin of a given node (e.g. "0", "1", "3"). */
  netOf: (nodeId: string, pinId: string) => string;
  /** All distinct net names present, "0" first. */
  nets: string[];
}

const ep = (nodeId: string, pinId: string) => `${nodeId}:${pinId}`;

export function extractNets(
  nodes: Node<ComponentData>[],
  edges: Edge[],
): NetMap {
  const dsu = new DSU();
  const groundRoots = new Set<string>();

  // 1. Register every pin of every node, and mark ground endpoints.
  for (const node of nodes) {
    const spec = COMPONENT_SPECS[node.data.kind];
    for (const pin of spec.pins) {
      const e = ep(node.id, pin.id);
      dsu.add(e);
      if (node.data.kind === "GND") groundRoots.add(e);
    }
  }

  // 2. Union endpoints joined by wires.
  for (const edge of edges) {
    if (!edge.sourceHandle || !edge.targetHandle) continue;
    dsu.union(ep(edge.source, edge.sourceHandle), ep(edge.target, edge.targetHandle));
  }

  // 3. Collapse all ground endpoints into a single net.
  const groundList = [...groundRoots];
  for (let i = 1; i < groundList.length; i++) dsu.union(groundList[0], groundList[i]);
  const groundRoot = groundList.length ? dsu.root(groundList[0]) : null;

  // 4. Assign names. Ground root -> "0". Net-label (NODE) elements force their
  //    group's name to the label's `name` attribute. Everything else -> 1,2,3...
  const nameByRoot = new Map<string, string>();
  const order: string[] = [];
  if (groundRoot) {
    nameByRoot.set(groundRoot, "0");
    order.push("0");
  }
  for (const node of nodes) {
    if (node.data.kind !== "NODE") continue;
    const spec = COMPONENT_SPECS.NODE;
    const root = dsu.root(ep(node.id, spec.pins[0].id));
    if (nameByRoot.has(root)) continue; // ground or an earlier label wins
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

  // Pre-name every real pin so the net list is complete and deterministic.
  for (const node of nodes) {
    const spec = COMPONENT_SPECS[node.data.kind];
    for (const pin of spec.pins) nameFor(dsu.root(ep(node.id, pin.id)));
  }

  return {
    netOf: (nodeId, pinId) => nameFor(dsu.root(ep(nodeId, pinId))),
    nets: order,
  };
}
