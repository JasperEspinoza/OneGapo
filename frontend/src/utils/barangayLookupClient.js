import { getKnownBarangayName } from '../constants/barangays';

let cachedBoundaries = null;
let loadPromise = null;

export async function getClientBoundaries() {
  if (cachedBoundaries) return cachedBoundaries;
  if (!loadPromise) {
    loadPromise = fetch('/data/olongapoBoundaries.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.features) && data.features.length > 0) {
          cachedBoundaries = data;
          return data;
        }
        return null;
      })
      .catch(() => null);
  }
  return loadPromise;
}

export function pointInRing(point, ring) {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygonCoords(point, coordinates) {
  if (!coordinates || coordinates.length === 0) return false;
  if (!pointInRing(point, coordinates[0])) return false;
  for (let h = 1; h < coordinates.length; h++) {
    if (pointInRing(point, coordinates[h])) return false;
  }
  return true;
}

export function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  const { type, coordinates } = geometry;
  if (type === 'Polygon') {
    return pointInPolygonCoords(point, coordinates);
  }
  if (type === 'MultiPolygon') {
    for (const poly of coordinates) {
      if (pointInPolygonCoords(point, poly)) return true;
    }
  }
  return false;
}

export function findBarangayFromGeoJson(lat, lng, boundaries) {
  if (
    !boundaries ||
    !Array.isArray(boundaries.features) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  const point = [lng, lat];
  for (const feature of boundaries.features) {
    if (pointInGeometry(point, feature.geometry)) {
      const rawName = feature.properties?.name || '';
      return getKnownBarangayName(rawName) || rawName || null;
    }
  }
  return null;
}

export async function lookupBarangayClient(lat, lng) {
  const boundaries = await getClientBoundaries();
  if (!boundaries) return null;
  return findBarangayFromGeoJson(lat, lng, boundaries);
}
