const R = 6371008.8; // mean Earth radius, metres
const rad = Math.PI / 180;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Polygon ring approximating a circle of `radius` metres, for map drawing. */
export function circleRing(lat: number, lon: number, radius: number, steps = 48): [number, number][] {
  const ring: [number, number][] = [];
  const dLat = radius / R / rad;
  const dLon = dLat / Math.cos(lat * rad);
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return ring;
}
