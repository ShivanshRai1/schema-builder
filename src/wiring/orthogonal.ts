/** Grid-aligned orthogonal routing helpers (LTspice-style click wiring). */

export interface Point {
  x: number;
  y: number;
}

export type PinSide = "left" | "right" | "top" | "bottom";

export const WIRE_GRID = 16;

export function snapCoord(n: number, grid = WIRE_GRID): number {
  return Math.round(n / grid) * grid;
}

export function snapPoint(p: Point, grid = WIRE_GRID): Point {
  return { x: snapCoord(p.x, grid), y: snapCoord(p.y, grid) };
}

/** Project cursor onto a single H or V ray from `from` (larger delta wins). */
export function projectOrthogonal(from: Point, cursor: Point, grid = WIRE_GRID): Point {
  const snapped = snapPoint(cursor, grid);
  const dx = Math.abs(snapped.x - from.x);
  const dy = Math.abs(snapped.y - from.y);
  if (dx >= dy) return { x: snapped.x, y: from.y };
  return { x: from.x, y: snapped.y };
}

export function pointsEqual(a: Point, b: Point, eps = 0.5): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Point just outside a pin, so the final segment hits the pin dead-center. */
export function outwardStub(pin: Point, side: PinSide, stub = 16): Point {
  switch (side) {
    case "left":
      return { x: pin.x - stub, y: pin.y };
    case "right":
      return { x: pin.x + stub, y: pin.y };
    case "top":
      return { x: pin.x, y: pin.y - stub };
    case "bottom":
      return { x: pin.x, y: pin.y + stub };
  }
}

/**
 * Build an orthogonal polyline from start → waypoints → end.
 * If consecutive points are not aligned, insert one elbow.
 */
export function orthogonalPolyline(points: Point[]): Point[] {
  if (points.length === 0) return [];
  const out: Point[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1]!;
    const next = points[i]!;
    if (pointsEqual(prev, next)) continue;
    if (Math.abs(prev.x - next.x) < 0.5 || Math.abs(prev.y - next.y) < 0.5) {
      out.push(next);
    } else {
      out.push({ x: next.x, y: prev.y });
      out.push(next);
    }
  }
  return out;
}

/**
 * Route start→waypoints→end with short stubs so wires enter/leave pins
 * perpendicular to the part edge (exact pin centers, like freehand attach).
 *
 * With no waypoints, bend in the pin's exit axis first (vertical from left/right
 * pins, horizontal from top/bottom) so the run does not fold back through the part.
 */
export function routeWirePoints(
  start: Point,
  end: Point,
  waypoints: Point[],
  sourceSide: PinSide,
  targetSide: PinSide,
  stub = 16,
): Point[] {
  const startOut = outwardStub(start, sourceSide, stub);
  const endOut = outwardStub(end, targetSide, stub);

  if (waypoints.length === 0) {
    const bend = exitFirstBend(startOut, endOut, sourceSide);
    return orthogonalPolyline([start, startOut, ...bend, endOut, end]);
  }

  return orthogonalPolyline([start, startOut, ...waypoints, endOut, end]);
}

/** One elbow that continues along the source exit before turning to the target. */
function exitFirstBend(startOut: Point, endOut: Point, sourceSide: PinSide): Point[] {
  if (pointsEqual(startOut, endOut)) return [];
  const aligned =
    Math.abs(startOut.x - endOut.x) < 0.5 || Math.abs(startOut.y - endOut.y) < 0.5;
  if (aligned) return [];

  // Left/right pins: keep x (go vertical first). Top/bottom: keep y (go horizontal first).
  if (sourceSide === "left" || sourceSide === "right") {
    return [{ x: startOut.x, y: endOut.y }];
  }
  return [{ x: endOut.x, y: startOut.y }];
}

export function polylinePath(points: Point[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  let d = `M ${first!.x} ${first!.y}`;
  for (const p of rest) d += ` L ${p.x} ${p.y}`;
  return d;
}
