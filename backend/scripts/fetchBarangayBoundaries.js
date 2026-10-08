/**
 * scripts/fetchBarangayBoundaries.js
 *
 * One-time setup script — fetches Olongapo City barangay administrative
 * boundaries from the Overpass API (OpenStreetMap) and saves them as GeoJSON
 * to constants/olongapoBoundaries.json
 *
 * OSM represents Philippine barangays as admin_level=10 boundary relations.
 * We fetch all of them inside Olongapo City (admin_level=6) and convert the
 * outer-way members to GeoJSON Polygon / MultiPolygon geometries.
 *
 * Run: node scripts/fetchBarangayBoundaries.js
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── Canonical barangay name map (OSM names → our canonical names) ─────────────
// OSM may store names with slight variations; this maps them to what the system uses.
const NAME_MAP = {
  'Asinan': 'Asinan',
  'Banicain': 'Banicain',
  'Barretto': 'Barretto',
  'East Bajac-Bajac': 'East Bajac-Bajac',
  'East Bajac-bajac': 'East Bajac-Bajac',
  'East Tapinac': 'East Tapinac',
  'Gordon Heights': 'Gordon Heights',
  'Kababae': 'Kababae',
  'Kalaklan': 'Kalaklan',
  'Kalalake': 'Kalalake',
  'Mabayuan': 'Mabayuan',
  'New Cabalan': 'New Cabalan',
  'New Ilalim': 'New Ilalim',
  'New Kababae': 'New Kababae',
  'New Kalalake': 'New Kalalake',
  'Old Cabalan': 'Old Cabalan',
  'Pag-asa': 'Pag-asa',
  'Pagasa': 'Pag-asa',
  'Santa Rita': 'Sta. Rita',
  'Sta. Rita': 'Sta. Rita',
  'West Bajac-Bajac': 'West Bajac-Bajac',
  'West Bajac-bajac': 'West Bajac-Bajac',
  'West Tapinac': 'West Tapinac',
};

const PSGC_MAP = {
  'Asinan': '034614001',
  'Banicain': '034614002',
  'Barretto': '034614003',
  'East Bajac-Bajac': '034614004',
  'East Tapinac': '034614005',
  'Gordon Heights': '034614006',
  'Kababae': '034614007',
  'Kalaklan': '034614008',
  'Kalalake': '034614009',
  'Mabayuan': '034614010',
  'New Cabalan': '034614011',
  'New Ilalim': '034614012',
  'New Kababae': '034614013',
  'New Kalalake': '034614014',
  'Old Cabalan': '034614015',
  'Pag-asa': '034614016',
  'Sta. Rita': '034614017',
  'West Bajac-Bajac': '034614018',
  'West Tapinac': '034614019',
};

// ─── HTTP helper ───────────────────────────────────────────────────────────────

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(body, 'utf8');
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': bodyBuf.length,
        'User-Agent': 'OneGapo/1.0 (barangay-boundary-fetch)',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        }
        try { resolve(JSON.parse(data)); } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}\nBody start: ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(90000, () => { req.destroy(); reject(new Error('Overpass request timed out')); });
    req.write(bodyBuf);
    req.end();
  });
}

// ─── GeoJSON conversion ────────────────────────────────────────────────────────

/**
 * Given a flat list of OSM way objects (each with a .geometry array of lat/lon nodes),
 * assemble them into a closed ring. Returns an array of [lng, lat] pairs (GeoJSON order).
 */
function assembleRing(ways) {
  if (ways.length === 0) return null;

  // Build a map of node coordinates keyed by node id for quick lookup
  // ways already have geometry arrays, so we chain them
  const segments = ways.map((w) => {
    const coords = (w.geometry || []).map((n) => [n.lon, n.lat]);
    return coords;
  });

  if (segments.length === 1) {
    const s = segments[0];
    if (s.length < 3) return null;
    // Ensure closed
    const first = s[0], last = s[s.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) s.push([...first]);
    return s;
  }

  // Chain segments into a continuous ring
  const ring = [...segments[0]];
  const remaining = segments.slice(1);

  for (let attempt = 0; attempt < remaining.length * 2; attempt++) {
    const tail = ring[ring.length - 1];
    let joined = false;
    for (let i = 0; i < remaining.length; i++) {
      const seg = remaining[i];
      const head = seg[0];
      const end = seg[seg.length - 1];
      if (Math.abs(head[0] - tail[0]) < 1e-7 && Math.abs(head[1] - tail[1]) < 1e-7) {
        ring.push(...seg.slice(1));
        remaining.splice(i, 1);
        joined = true;
        break;
      }
      if (Math.abs(end[0] - tail[0]) < 1e-7 && Math.abs(end[1] - tail[1]) < 1e-7) {
        ring.push(...[...seg].reverse().slice(1));
        remaining.splice(i, 1);
        joined = true;
        break;
      }
    }
    if (!joined) break;
  }

  // Close the ring
  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return ring.length >= 4 ? ring : null;
}

/**
 * Convert an OSM relation (with geom members) to a GeoJSON geometry.
 */
function relationToGeometry(relation) {
  const members = (relation.members || []).filter((m) => m.type === 'way');

  const outerWays = members.filter((m) => m.role === 'outer');
  const innerWays = members.filter((m) => m.role === 'inner');

  const outerRing = assembleRing(outerWays);
  if (!outerRing) return null;

  const rings = [outerRing];

  if (innerWays.length > 0) {
    const innerRing = assembleRing(innerWays);
    if (innerRing) rings.push(innerRing);
  }

  return { type: 'Polygon', coordinates: rings };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const outputPath = path.join(__dirname, '..', 'constants', 'olongapoBoundaries.json');

  // Overpass query: get all admin_level=10 boundary relations inside Olongapo City
  const query = `[out:json][timeout:90];
area["name"="Olongapo"]["admin_level"="6"]["boundary"="administrative"]->.city;
(
  relation(area.city)["admin_level"="10"]["boundary"="administrative"];
);
out geom;`;

  console.log('Querying Overpass API for Olongapo barangay boundaries...');
  console.log('Query:\n', query, '\n');

  let osmData;
  try {
    osmData = await httpPost('https://overpass-api.de/api/interpreter', `data=${encodeURIComponent(query)}`);
  } catch (err) {
    console.error('Overpass query failed:', err.message);
    // Try backup endpoint
    console.log('Trying backup endpoint...');
    try {
      osmData = await httpPost('https://overpass.kumi.systems/api/interpreter', `data=${encodeURIComponent(query)}`);
    } catch (err2) {
      console.error('Backup endpoint also failed:', err2.message);
      process.exit(1);
    }
  }

  const relations = (osmData.elements || []).filter((e) => e.type === 'relation');
  console.log(`Found ${relations.length} boundary relations in OSM.\n`);

  if (relations.length === 0) {
    console.error('No relations found. The Overpass query may need adjustment.');
    console.log('Full response:', JSON.stringify(osmData).slice(0, 500));
    process.exit(1);
  }

  const features = [];
  const missing = [];
  const found = new Set();

  for (const relation of relations) {
    const osmName = relation.tags?.name || relation.tags?.['name:en'] || '';
    const canonicalName = NAME_MAP[osmName] || osmName;

    if (!canonicalName) {
      console.warn(`  Skipping relation ${relation.id} — no name tag`);
      continue;
    }

    const geometry = relationToGeometry(relation);
    if (!geometry) {
      console.warn(`  ✗ Could not build geometry for "${osmName}" (id: ${relation.id})`);
      continue;
    }

    found.add(canonicalName);
    console.log(`  ✓ ${canonicalName} (OSM: "${osmName}", id: ${relation.id})`);

    features.push({
      type: 'Feature',
      properties: {
        name: canonicalName,
        psgc: PSGC_MAP[canonicalName] || null,
        osmName,
        osmId: relation.id,
      },
      geometry,
    });
  }

  // Report missing
  for (const canonical of Object.values(NAME_MAP)) {
    if (!found.has(canonical) && !missing.includes(canonical)) {
      missing.push(canonical);
    }
  }

  const geojson = {
    type: 'FeatureCollection',
    generated: new Date().toISOString(),
    source: 'OpenStreetMap via Overpass API',
    note: 'admin_level=10 boundary relations for Olongapo City barangays',
    features,
  };

  fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2), 'utf8');

  console.log(`\n✅ Saved ${features.length} barangay boundaries to:\n   ${outputPath}`);
  if (missing.length > 0) {
    console.warn(`\n⚠ Barangays with no OSM boundary polygon (will use name-based fallback):`);
    missing.forEach((n) => console.warn(`   - ${n}`));
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
