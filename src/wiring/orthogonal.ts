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
export function projectOrthogonal(
  from: Point,
  cursor: Point,
  grid = WIRE_GRID,
  preferAxis: "h" | "v" | null = null,
): Point {
  const snapped = snapPoint(cursor, grid);
  const dx = Math.abs(snapped.x - from.x);
  const dy = Math.abs(snapped.y - from.y);

  if (preferAxis === "v") {
    if (dx > dy * 1.75 && dx >= grid) return { x: snapped.x, y: from.y };
    return { x: from.x, y: snapped.y };
  }
  if (preferAxis === "h") {
    if (dy > dx * 1.75 && dy >= grid) return { x: from.x, y: snapped.y };
    return { x: snapped.x, y: from.y };
  }

  if (dx >= dy) return { x: snapped.x, y: from.y };
  return { x: from.x, y: snapped.y };
}

/**
 * Live rubber-band: same H/V lock as projectOrthogonal, but unsnapped so the
 * free end tracks the cursor smoothly. Lock bends still use projectOrthogonal.
 */
export function projectOrthogonalLive(
  from: Point,
  cursor: Point,
  preferAxis: "h" | "v" | null = null,
): Point {
  const dx = Math.abs(cursor.x - from.x);
  const dy = Math.abs(cursor.y - from.y);
  if (preferAxis === "v") {
    if (dx > dy * 1.75 && dx >= WIRE_GRID) return { x: cursor.x, y: from.y };
    return { x: from.x, y: cursor.y };
  }
  if (preferAxis === "h") {
    if (dy > dx * 1.75 && dy >= WIRE_GRID) return { x: from.x, y: cursor.y };
    return { x: cursor.x, y: from.y };
  }
  if (dx >= dy) return { x: cursor.x, y: from.y };
  return { x: from.x, y: cursor.y };
}

/** Axis of the segment ending at `to` (from `from`), or null if degenerate. */
export function segmentAxis(from: Point, to: Point): "h" | "v" | null {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (dx < 0.5 && dy < 0.5) return null;
  if (dx < 0.5) return "v";
  if (dy < 0.5) return "h";
  return dx >= dy ? "h" : "v";
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
 * Empty waypoints: leave along the source exit, then approach the target pin
 * from its outward side (never run through the part — that looked like a 180°
 * attach to the opposite pin).
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
    const bend = clearApproachBend(
      startOut,
      endOut,
      start,
      end,
      sourceSide,
      targetSide,
      stub,
    );
    return orthogonalPolyline([start, startOut, ...bend, endOut, end]);
  }

  return orthogonalPolyline([start, startOut, ...waypoints, endOut, end]);
}

/**
 * Bend points between startOut and endOut.
 * Stay in each pin's outward half-plane so the run never cuts through a part
 * (180° left/right and 270° top/bottom false attaches).
 */
function clearApproachBend(
  startOut: Point,
  endOut: Point,
  start: Point,
  end: Point,
  sourceSide: PinSide,
  targetSide: PinSide,
  stub: number,
): Point[] {
  if (pointsEqual(startOut, endOut)) return [];
  const aligned =
    Math.abs(startOut.x - endOut.x) < 0.5 || Math.abs(startOut.y - endOut.y) < 0.5;
  if (aligned) return [];

  const pad = stub * 3;
  const bends: Point[] = [];

  // --- Leave source without re-entering its body toward the target ---
  if (sourceSide === "top" && endOut.y > startOut.y + 1) {
    const left = start.x - pad;
    const right = start.x + pad;
    let clearX = endOut.x;
    if (clearX > left && clearX < right) {
      clearX = endOut.x <= start.x ? left - stub : right + stub;
    }
    if (Math.abs(clearX - startOut.x) > 0.5) {
      bends.push({ x: clearX, y: startOut.y });
    }
    if (Math.abs(clearX - endOut.x) > 0.5 || Math.abs(startOut.y - endOut.y) > 0.5) {
      bends.push({ x: clearX, y: endOut.y });
    }
    return dedupeBends(bends, endOut);
  }

  if (sourceSide === "bottom" && endOut.y < startOut.y - 1) {
    const left = start.x - pad;
    const right = start.x + pad;
    let clearX = endOut.x;
    if (clearX > left && clearX < right) {
      clearX = endOut.x <= start.x ? left - stub : right + stub;
    }
    if (Math.abs(clearX - startOut.x) > 0.5) {
      bends.push({ x: clearX, y: startOut.y });
    }
    bends.push({ x: clearX, y: endOut.y });
    return dedupeBends(bends, endOut);
  }

  if (sourceSide === "left" && endOut.x > startOut.x + 1) {
    const top = start.y - pad;
    const bot = start.y + pad;
    let clearY = endOut.y;
    if (clearY > top && clearY < bot) {
      clearY = endOut.y <= start.y ? top - stub : bot + stub;
    }
    if (Math.abs(clearY - startOut.y) > 0.5) {
      bends.push({ x: startOut.x, y: clearY });
    }
    bends.push({ x: endOut.x, y: clearY });
    return dedupeBends(bends, endOut);
  }

  if (sourceSide === "right" && endOut.x < startOut.x - 1) {
    const top = start.y - pad;
    const bot = start.y + pad;
    let clearY = endOut.y;
    if (clearY > top && clearY < bot) {
      clearY = endOut.y <= start.y ? top - stub : bot + stub;
    }
    if (Math.abs(clearY - startOut.y) > 0.5) {
      bends.push({ x: startOut.x, y: clearY });
    }
    bends.push({ x: endOut.x, y: clearY });
    return dedupeBends(bends, endOut);
  }

  // --- Approach target from its outward side ---
  if (targetSide === "right" && startOut.x < endOut.x - 1) {
    const top = end.y - pad;
    const bot = end.y + pad;
    let runY = startOut.y;
    if (runY > top && runY < bot) {
      runY = startOut.y <= end.y ? top - stub : bot + stub;
      return [
        { x: startOut.x, y: runY },
        { x: endOut.x, y: runY },
      ];
    }
    return [{ x: endOut.x, y: startOut.y }];
  }

  if (targetSide === "left" && startOut.x > endOut.x + 1) {
    const top = end.y - pad;
    const bot = end.y + pad;
    let runY = startOut.y;
    if (runY > top && runY < bot) {
      runY = startOut.y <= end.y ? top - stub : bot + stub;
      return [
        { x: startOut.x, y: runY },
        { x: endOut.x, y: runY },
      ];
    }
    return [{ x: endOut.x, y: startOut.y }];
  }

  if (targetSide === "bottom" && startOut.y < endOut.y - 1) {
    const left = end.x - pad;
    const right = end.x + pad;
    let dropX = startOut.x;
    if (dropX > left && dropX < right) {
      dropX = startOut.x <= end.x ? left - stub : right + stub;
      return [
        { x: dropX, y: startOut.y },
        { x: dropX, y: endOut.y },
        { x: endOut.x, y: endOut.y },
      ];
    }
    return [
      { x: startOut.x, y: endOut.y },
      { x: endOut.x, y: endOut.y },
    ];
  }

  if (targetSide === "top" && startOut.y > endOut.y + 1) {
    const left = end.x - pad;
    const right = end.x + pad;
    let riseX = startOut.x;
    if (riseX > left && riseX < right) {
      riseX = startOut.x <= end.x ? left - stub : right + stub;
      return [
        { x: riseX, y: startOut.y },
        { x: riseX, y: endOut.y },
        { x: endOut.x, y: endOut.y },
      ];
    }
    return [
      { x: startOut.x, y: endOut.y },
      { x: endOut.x, y: endOut.y },
    ];
  }

  if (sourceSide === "left" || sourceSide === "right") {
    return [{ x: startOut.x, y: endOut.y }];
  }
  return [{ x: endOut.x, y: startOut.y }];
}

function dedupeBends(bends: Point[], endOut: Point): Point[] {
  const out: Point[] = [];
  for (const p of bends) {
    const prev = out[out.length - 1];
    if (prev && pointsEqual(prev, p)) continue;
    if (pointsEqual(p, endOut)) continue;
    out.push(p);
  }
  return out;
}

export function polylinePath(points: Point[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  let d = `M ${first!.x} ${first!.y}`;
  for (const p of rest) d += ` L ${p.x} ${p.y}`;
  return d;
}
