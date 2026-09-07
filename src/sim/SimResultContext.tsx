import { createContext, useContext } from "react";
import type { SimResult } from "./runSimulation";

/** Latest successful (or demo) sim result — drives post-run V/I probe hover on the canvas. */
export const SimResultContext = createContext<SimResult | null>(null);

export function useSimResult(): SimResult | null {
  return useContext(SimResultContext);
}
