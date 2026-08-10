import type { ComponentRotation, PinSpec } from "./types";

export type { ComponentRotation };

export function normalizeRotation(value: unknown): ComponentRotation {
  const n = typeof value === "number" ? value : Number(value);
  if (n === 90 || n === 180 || n === 270) return n;
  return 0;
}

/** Next 90° clockwise step (LTspice-style rotate). */
export function nextRotation(current: unknown): ComponentRotation {
  const r = normalizeRotation(current);
  return ((r + 90) % 360) as ComponentRotation;
}

const SIDE_CW: Record<PinSpec["side"], PinSpec["side"]> = {
  left: "top",
  top: "right",
  right: "bottom",
  bottom: "left",
};

/**
 * Remap catalog pin geometry for a clockwise rotation.
 * Electrical pin `id` is unchanged — only side/offset for Handle placement.
 */
export function rotatePinSpec(pin: PinSpec, rotation: unknown): PinSpec {
  const steps = normalizeRotation(rotation) / 90;
  let side = pin.side;
  let offset = pin.offset;
  for (let i = 0; i < steps; i++) {
    side = SIDE_CW[side];
  }
  // 180° and 270° flip along-side offset so pin ends stay visually consistent.
  if (steps === 2 || steps === 3) {
    offset = 1 - offset;
  }
  return { ...pin, side, offset };
}
