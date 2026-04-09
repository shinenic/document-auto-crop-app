/**
 * Fit a single cubic Bézier to a polyline using least-squares.
 *
 * Given N points, we fix p0 = first point, p3 = last point,
 * and solve for cp1, cp2 that minimise the sum of squared distances.
 *
 * The parameter t for each point is assigned by chord-length parameterisation.
 */

type Pt = [number, number];

export function fitCubicBezier(
  points: { x: number; y: number }[],
): { p0: Pt; cp1: Pt; cp2: Pt; p3: Pt } {
  if (points.length < 2) {
    const p: Pt = points.length === 1 ? [points[0].x, points[0].y] : [0, 0];
    return { p0: p, cp1: p, cp2: p, p3: p };
  }

  const p0: Pt = [points[0].x, points[0].y];
  const p3: Pt = [points[points.length - 1].x, points[points.length - 1].y];

  if (points.length <= 3) {
    return {
      p0,
      cp1: [p0[0] + (p3[0] - p0[0]) / 3, p0[1] + (p3[1] - p0[1]) / 3],
      cp2: [p0[0] + (2 * (p3[0] - p0[0])) / 3, p0[1] + (2 * (p3[1] - p0[1])) / 3],
      p3,
    };
  }

  // Chord-length parameterisation
  const ts: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    ts.push(ts[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalLen = ts[ts.length - 1];
  if (totalLen === 0) {
    return { p0, cp1: [...p0], cp2: [...p3], p3 };
  }
  for (let i = 0; i < ts.length; i++) ts[i] /= totalLen;

  // Bernstein basis: B0=(1-t)^3, B1=3t(1-t)^2, B2=3t^2(1-t), B3=t^3
  // We know p0 and p3, solve for cp1 and cp2:
  // point_i ≈ B0*p0 + B1*cp1 + B2*cp2 + B3*p3
  // => B1*cp1 + B2*cp2 ≈ point_i - B0*p0 - B3*p3
  let a11 = 0, a12 = 0, a22 = 0;
  let rx1 = 0, ry1 = 0, rx2 = 0, ry2 = 0;

  for (let i = 0; i < points.length; i++) {
    const t = ts[i];
    const u = 1 - t;
    const b0 = u * u * u;
    const b1 = 3 * t * u * u;
    const b2 = 3 * t * t * u;
    const b3 = t * t * t;

    a11 += b1 * b1;
    a12 += b1 * b2;
    a22 += b2 * b2;

    const rhsX = points[i].x - b0 * p0[0] - b3 * p3[0];
    const rhsY = points[i].y - b0 * p0[1] - b3 * p3[1];

    rx1 += b1 * rhsX;
    ry1 += b1 * rhsY;
    rx2 += b2 * rhsX;
    ry2 += b2 * rhsY;
  }

  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-12) {
    return {
      p0,
      cp1: [p0[0] + (p3[0] - p0[0]) / 3, p0[1] + (p3[1] - p0[1]) / 3],
      cp2: [p0[0] + (2 * (p3[0] - p0[0])) / 3, p0[1] + (2 * (p3[1] - p0[1])) / 3],
      p3,
    };
  }

  const cp1: Pt = [
    (a22 * rx1 - a12 * rx2) / det,
    (a22 * ry1 - a12 * ry2) / det,
  ];
  const cp2: Pt = [
    (a11 * rx2 - a12 * rx1) / det,
    (a11 * ry2 - a12 * ry1) / det,
  ];

  return { p0, cp1, cp2, p3 };
}
