/**
 * scripts/convertBoundaries.js
 *
 * One-time conversion script — takes the raw faeldon/philippines-json-maps
 * GeoJSON (with NAME_3 property) and converts it to the format expected by
 * barangayLookup.js (with canonical name + psgc fields).
 *
 * Run: node scripts/convertBoundaries.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, '..', 'constants', 'olongapoBoundaries_raw.json');
const outputPath = path.join(__dirname, '..', 'constants', 'olongapoBoundaries.json');

// Map raw NAME_3 values → our canonical barangay names
const NAME_NORMALIZE = {
  'Asinan':           'Asinan',
  'Banicain':         'Banicain',
  'Barreto':          'Barretto',   // note: source has single t
  'Barretto':         'Barretto',
  'East Bajac-Bajac': 'East Bajac-Bajac',
  'East Tapinac':     'East Tapinac',
  'Gordon Heights':   'Gordon Heights',
  'Kababae':          'Kababae',
  'Kalaklan':         'Kalaklan',
  'Kalalake':         'Kalalake',
  'Mabayuan':         'Mabayuan',
  'New Cabalan':      'New Cabalan',
  'New Ilalim':       'New Ilalim',
  'New Kababae':      'New Kababae',
  'New Kalalake':     'New Kalalake',
  'Old Cabalan':      'Old Cabalan',
  'Pag-Asa':          'Pag-asa',
  'Pag-asa':          'Pag-asa',
  'Santa Rita':       'Sta. Rita',
  'Sta. Rita':        'Sta. Rita',
  'West Bajac-Bajac': 'West Bajac-Bajac',
  'West Tapinac':     'West Tapinac',
};

const PSGC_MAP = {
  'Asinan':           '034614001',
  'Banicain':         '034614002',
  'Barretto':         '034614003',
  'East Bajac-Bajac': '034614004',
  'East Tapinac':     '034614005',
  'Gordon Heights':   '034614006',
  'Kababae':          '034614007',
  'Kalaklan':         '034614008',
  'Kalalake':         '034614009',
  'Mabayuan':         '034614010',
  'New Cabalan':      '034614011',
  'New Ilalim':       '034614012',
  'New Kababae':      '034614013',
  'New Kalalake':     '034614014',
  'Old Cabalan':      '034614015',
  'Pag-asa':          '034614016',
  'Sta. Rita':        '034614017',
  'West Bajac-Bajac': '034614018',
  'West Tapinac':     '034614019',
};

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const seen = new Set();
const features = [];

for (const feature of raw.features) {
  const rawName = feature.properties?.NAME_3 || feature.properties?.name || '';
  const canonical = NAME_NORMALIZE[rawName];

  if (!canonical) {
    console.warn(`⚠ Unknown barangay name: "${rawName}" — skipping`);
    continue;
  }

  if (seen.has(canonical)) {
    console.warn(`⚠ Duplicate: "${canonical}" — skipping`);
    continue;
  }
  seen.add(canonical);

  features.push({
    type: 'Feature',
    properties: {
      name: canonical,
      psgc: PSGC_MAP[canonical] || null,
      sourceName: rawName,
    },
    geometry: feature.geometry,
  });

  console.log(`  ✓ ${canonical} (source: "${rawName}", type: ${feature.geometry.type})`);
}

// Check for missing barangays
const allCanonical = new Set(Object.values(NAME_NORMALIZE));
const missing = [...allCanonical].filter((n) => !seen.has(n));
if (missing.length) {
  console.warn(`\n⚠ Missing barangays (will fall back to name-based routing):`);
  missing.forEach((n) => console.warn(`   - ${n}`));
}

const output = {
  type: 'FeatureCollection',
  generated: new Date().toISOString(),
  source: 'faeldon/philippines-json-maps (2011 census boundaries)',
  note: 'Olongapo City barangay boundary polygons. Canonical names normalized.',
  features,
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
console.log(`\n✅ Wrote ${features.length} barangay boundaries to ${outputPath}`);
