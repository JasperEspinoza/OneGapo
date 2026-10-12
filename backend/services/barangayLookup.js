/**
 * services/barangayLookup.js
 *
 * Server-side point-in-polygon barangay detection for Olongapo City.
 *
 * Uses pre-fetched GeoJSON boundary data (constants/olongapoBoundaries.json).
 * Pure JS ray-casting — no extra npm dependencies.
 *
 * Falls back gracefully to null if boundaries are not loaded.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Load boundary data once at startup ───────────────────────────────────────

const BOUNDARIES_PATH = path.join(__dirname, '..', 'constants', 'olongapoBoundaries.json');

let _boundaries = null; // GeoJSON FeatureCollection

function loadBoundaries() {
  if (_boundaries !== null) return _boundaries;
  try {
    if (!fs.existsSync(BOUNDARIES_PATH)) {
      console.warn(
        '[barangayLookup] olongapoBoundaries.json not found. ' +
        'Run: node scripts/fetchBarangayBoundaries.js to generate it. ' +
        'Falling back to name-based routing.'
      );
      _boundaries = { type: 'FeatureCollection', features: [] };
      return _boundaries;
    }
    const raw = fs.readFileSync(BOUNDARIES_PATH, 'utf8');
    _boundaries = JSON.parse(raw);
    const count = (_boundaries.features || []).length;
    console.log(`[barangayLookup] Loaded ${count} barangay boundaries from ${BOUNDARIES_PATH}`);
  } catch (err) {
    console.error('[barangayLookup] Failed to load boundaries:', err.message);
    _boundaries = { type: 'FeatureCollection', features: [] };
  }
  return _boundaries;
}

// Load immediately on module import
loadBoundaries();

// ─── Pure-JS point-in-polygon (ray casting) ───────────────────────────────────

/**
 * Test whether a point is inside a GeoJSON ring (array of [lng, lat] pairs).
 * Uses the even-odd ray-casting algorithm.
 * @param {number[]} point - [lng, lat]
 * @param {number[][]} ring - array of [lng, lat] coordinate pairs
 * @returns {boolean}
 */
function pointInRing(point, ring) {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Test whether a point is inside a GeoJSON Polygon geometry.
 * The first ring is the outer boundary; subsequent rings are holes.
 * @param {number[]} point - [lng, lat]
 * @param {number[][][]} rings - Polygon.coordinates
 * @returns {boolean}
 */
function pointInPolygon(point, rings) {
  if (!rings || rings.length === 0) return false;
  // Must be inside the outer ring
  if (!pointInRing(point, rings[0])) return false;
  // Must NOT be inside any hole
  for (let h = 1; h < rings.length; h++) {
    if (pointInRing(point, rings[h])) return false;
  }
  return true;
}

/**
 * Test whether a point is inside a GeoJSON geometry (Polygon or MultiPolygon).
 * @param {number[]} point - [lng, lat]
 * @param {{ type: string, coordinates: any }} geometry
 * @returns {boolean}
 */
function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    return pointInPolygon(point, geometry.coordinates);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((poly) => pointInPolygon(point, poly));
  }
  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

function distanceToSegmentSquared(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return (px - x1) * (px - x1) + (py - y1) * (py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (x1 + t * (x2 - x1));
  const dy = py - (y1 + t * (y2 - y1));
  return dx * dx + dy * dy;
}

function findNearestBarangayFeature(lat, lng, features) {
  let minDistanceSq = Infinity;
  let closestFeature = null;

  for (const feature of features) {
    if (!feature.geometry || !feature.properties) continue;
    const geom = feature.geometry;
    let ringsList = [];
    if (geom.type === 'Polygon') {
      ringsList = geom.coordinates;
    } else if (geom.type === 'MultiPolygon') {
      ringsList = geom.coordinates.flatMap((poly) => poly);
    }

    for (const ring of ringsList) {
      if (!Array.isArray(ring) || ring.length < 2) continue;
      for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[i + 1];
        const distSq = distanceToSegmentSquared(lng, lat, x1, y1, x2, y2);
        if (distSq < minDistanceSq) {
          minDistanceSq = distSq;
          closestFeature = feature;
        }
      }
    }
  }

  return closestFeature;
}

/**
 * Given a latitude and longitude, find which Olongapo barangay polygon contains it.
 * If the point is on an edge, coastline, or boundary seam, it resolves to the nearest
 * barangay boundary.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {{ name: string, psgc: string } | null}
 *   The matched barangay, or null if outside all known boundaries.
 */
function findBarangayByCoordinates(lat, lng) {
  const boundaries = loadBoundaries();
  const features = boundaries.features || [];
  if (features.length === 0) return null;

  // GeoJSON uses [lng, lat] order
  const point = [lng, lat];

  // 1. Exact point-in-polygon test
  for (const feature of features) {
    if (!feature.geometry || !feature.properties) continue;
    if (pointInGeometry(point, feature.geometry)) {
      return {
        name: feature.properties.name,
        psgc: feature.properties.psgc || null,
      };
    }
  }

  // 2. Fallback to nearest boundary line for points on seams/roads/edges
  const nearest = findNearestBarangayFeature(lat, lng, features);
  if (nearest && nearest.properties) {
    return {
      name: nearest.properties.name,
      psgc: nearest.properties.psgc || null,
    };
  }

  return null;
}

/**
 * Returns true if the boundaries file has been loaded and has at least one polygon.
 * Use this to decide whether to trust coordinate-based lookup.
 */
function hasBoundaryData() {
  const boundaries = loadBoundaries();
  return (boundaries.features || []).length > 0;
}

/**
 * Returns all loaded barangay boundary features as a GeoJSON FeatureCollection.
 * Useful for serving to the frontend to display on the map.
 */
function getBoundariesGeoJSON() {
  return loadBoundaries();
}

module.exports = {
  findBarangayByCoordinates,
  hasBoundaryData,
  getBoundariesGeoJSON,
};
