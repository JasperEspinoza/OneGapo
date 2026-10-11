/**
 * scripts/convertBoundaries.js
 *
 * Converts and filters GeoJSON boundary data for Olongapo City.
 * Reads from root barangays.geojson (or constants/olongapoBoundaries.json),
 * keeps only Olongapo City barangays, normalizes names to canonical format,
 * and saves to constants/olongapoBoundaries.json and barangays.geojson.
 *
 * Run: node scripts/convertBoundaries.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const rootGeoJsonPath = path.join(__dirname, '..', '..', 'barangays.geojson');
const rawConstantsPath = path.join(__dirname, '..', 'constants', 'olongapoBoundaries_raw.json');
const outputPath = path.join(__dirname, '..', 'constants', 'olongapoBoundaries.json');

const inputPath = fs.existsSync(rawConstantsPath) ? rawConstantsPath : rootGeoJsonPath;

const NAME_NORMALIZE = {
  'Asinan': 'Asinan',
  'Banicain': 'Banicain',
  'Barreto': 'Barretto',
  'Barretto': 'Barretto',
  'East Bajac-bajac': 'East Bajac-Bajac',
  'East Bajac-Bajac': 'East Bajac-Bajac',
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
  'Pag-Asa': 'Pag-asa',
  'Pag-asa': 'Pag-asa',
  'Santa Rita': 'Sta. Rita',
  'Sta. Rita': 'Sta. Rita',
  'West Bajac-bajac': 'West Bajac-Bajac',
  'West Bajac-Bajac': 'West Bajac-Bajac',
  'West Tapinac': 'West Tapinac',
};

const PSGC_MAP = {
  'Asinan': '034614001',
  'Banicain': '034614002',
  'Barretto': '034614003',
  'East Bajac-Bajac': '034614004',
  'East Tapinac': '034614005',
  'Gordon Heights': '034614006',
  'Kalaklan': '034614008',
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

console.log(`Reading input GeoJSON from: ${inputPath}`);
const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

// Filter to Olongapo features if input is nationwide
const isNationwide = raw.features.some((f) => f.properties?.ADM3_EN && f.properties.ADM3_EN !== 'Olongapo City');
const sourceFeatures = isNationwide
  ? raw.features.filter((f) => {
      const p = f.properties || {};
      return (
        p.ADM3_EN === 'Olongapo City' ||
        p.ADM3_PCODE === 'PH0307107' ||
        (typeof p.ADM3_EN === 'string' && p.ADM3_EN.toLowerCase().includes('olongapo'))
      );
    })
  : raw.features;

console.log(`Found ${sourceFeatures.length} candidate features for Olongapo City`);

const seen = new Set();
const features = [];

for (const feature of sourceFeatures) {
  const rawName = feature.properties?.ADM4_EN || feature.properties?.name || feature.properties?.NAME_3 || '';
  const canonical = NAME_NORMALIZE[rawName] || rawName;

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
      psgc: PSGC_MAP[canonical] || feature.properties?.psgc_code || null,
      sourceName: rawName,
      adm4_pcode: feature.properties?.ADM4_PCODE || null,
      adm3_en: feature.properties?.ADM3_EN || 'Olongapo City',
      area_sqkm: feature.properties?.AREA_SQKM || null,
      ...feature.properties,
      name: canonical,
    },
    geometry: feature.geometry,
  });

  console.log(`  ✓ ${canonical} (source: "${rawName}", type: ${feature.geometry.type})`);
}

const output = {
  type: 'FeatureCollection',
  generated: new Date().toISOString(),
  source: 'Updated barangays.geojson (filtered to Olongapo City)',
  note: 'Olongapo City barangay boundary polygons. Non-Olongapo regions removed.',
  features,
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
console.log(`\n✅ Wrote ${features.length} barangay boundaries to ${outputPath}`);

if (fs.existsSync(rootGeoJsonPath)) {
  fs.writeFileSync(rootGeoJsonPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`✅ Updated root ${rootGeoJsonPath}`);
}
