import type { LabelPosition, PinSpec } from "../model/types";

export type ResolvedLabelPosition = Exclude<LabelPosition, "auto" | "hidden">;

export type LabelLayout =
  | { mode: "hidden" }
  | { mode: "split"; side: "right" | "left"; refdesY: number; valueY: number }
  | { mode: "block"; side: ResolvedLabelPosition };

/**
 * Upper / lower anchors for vertical parts.
 * Keep clear of the top/bottom pin pads (was 0.1 → sat on the collector/drain pin).
 */
const SPLIT_REFDES_Y = 0.28;
const SPLIT_VALUE_Y = 0.78;

function pinSides(pins: PinSpec[]): Set<PinSpec["side"]> {
  return new Set(pins.map((p) => p.side));
}

/**
 * Pin-aware label layout (LTspice-inspired):
 * - Parts with top+bottom pins: split refdes/value on a free side (never "above"
 *   the top pin — also covers 4-pin blocks like gate drivers / 5-pin op-amps).
 * - Horizontal-only parts (left+right): one block above the body.
 * - Net labels (pin left only): block to the right, past the flag.
 * - Net name text: sit on the opposite side of the invisible join point.
 */
export function resolveLabelLayout(
  pins: PinSpec[],
  override: LabelPosition | undefined = "auto",
  kind?: string,
): LabelLayout {
  if (override === "hidden") return { mode: "hidden" };
  if (override && override !== "auto") {
    return { mode: "block", side: override };
  }

  if (kind === "WIRELABEL") {
    // Text is drawn inside the rotated body (real spin), not relocated around the pin.
    return { mode: "hidden" };
  }

  const sides = pinSides(pins);

  // Must run before left+right — GATEDRV / OPAMP5 have all four sides.
  if (sides.has("top") && sides.has("bottom")) {
    const side: "right" | "left" = sides.has("right") && !sides.has("left") ? "left" : "right";
    return {
      mode: "split",
      side,
      refdesY: SPLIT_REFDES_Y,
      valueY: SPLIT_VALUE_Y,
    };
  }

  if (sides.has("left") && sides.has("right")) {
    return { mode: "block", side: "above" };
  }

  if (sides.has("bottom") && sides.size === 1) {
    return { mode: "block", side: "above" };
  }

  if (sides.has("top")) {
    return { mode: "block", side: "right" };
  }

  return { mode: "block", side: "right" };
}
