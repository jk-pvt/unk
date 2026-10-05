/* Small projection kit for the technical renders (battery, payload).
   A fixed oblique/dimetric camera: x runs right, y comes toward the viewer,
   z is up. Everything is plain SVG paths computed once per render. */

export function camera(ex, ey, ox = 0, oy = 0) {
  const P = (x, y, z) => [ox + x * ex[0] + y * ey[0], oy + x * ex[1] + y * ey[1] - z];
  return P;
}

/** Circle of radius r in the plane x = const (axis along x). */
export const ringX = (P, x, yc, zc, r, n = 40) =>
  Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return P(x, yc + r * Math.cos(t), zc + r * Math.sin(t));
  });

/** Circle of radius r in the plane z = const (axis along z). */
export const ringZ = (P, xc, yc, z, r, n = 40) =>
  Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return P(xc + r * Math.cos(t), yc + r * Math.sin(t), z);
  });

export const path = (pts, close = true) =>
  "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + (close ? "Z" : "");

/** Convex hull (monotone chain) — silhouette of a cylinder = hull of its two end rings. */
export function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [],
    up = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.reverse()) {
    while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Axis-aligned box → its six faces as point lists. */
export function box(P, x0, y0, z0, x1, y1, z1) {
  return {
    top: [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
    bottom: [P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)],
    front: [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)],
    back: [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)],
    right: [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)],
    left: [P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1)],
  };
}

export function bounds(list, pad = 6) {
  let a = Infinity,
    b = Infinity,
    c = -Infinity,
    d = -Infinity;
  for (const [x, y] of list) {
    a = Math.min(a, x);
    b = Math.min(b, y);
    c = Math.max(c, x);
    d = Math.max(d, y);
  }
  return [a - pad, b - pad, c - a + pad * 2, d - b + pad * 2];
}
