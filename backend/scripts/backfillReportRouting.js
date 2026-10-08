/**
 * scripts/backfillReportRouting.js
 *
 * One-time backfill to populate routingBarangay, routingBranchId, and
 * routingBranchName on legacy or existing reports using point-in-polygon
 * boundary lookup and the Firestore branches collection.
 */

require('dotenv').config();
const admin = require('../config/firebaseAdmin');
const { findBarangayByCoordinates } = require('../services/barangayLookup');

const COVERAGE_ALIASES = new Map([
  ['asinan', 'Asinan'],
  ['new asinan', 'Asinan'],
  ['poblacion', 'Asinan'],
  ['banicain', 'Banicain'],
  ['barretto', 'Barretto'],
  ['east bajac bajac', 'East Bajac-Bajac'],
  ['west bajac bajac', 'West Bajac-Bajac'],
  ['bajac bajac', 'Bajac-Bajac'],
  ['east tapinac', 'East Tapinac'],
  ['west tapinac', 'West Tapinac'],
  ['gordon heights', 'Gordon Heights'],
  ['kababae', 'Kababae'],
  ['new kababae', 'New Kababae'],
  ['kalaklan', 'Kalaklan'],
  ['kalalake', 'Kalalake'],
  ['new kalalake', 'New Kalalake'],
  ['mabayuan', 'Mabayuan'],
  ['new cabalan', 'New Cabalan'],
  ['old cabalan', 'Old Cabalan'],
  ['new ilalim', 'New Ilalim'],
  ['pag asa', 'Pag-asa'],
  ['pag-asa', 'Pag-asa'],
  ['sta rita', 'Sta. Rita'],
  ['sta. rita', 'Sta. Rita'],
  ['santa rita', 'Sta. Rita'],
]);

function normalizeToken(val) {
  return String(val || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function canonicalCoverageName(val) {
  const norm = normalizeToken(val);
  if (!norm) return '';
  return COVERAGE_ALIASES.get(norm) || '';
}

async function backfill() {
  const db = admin.firestore();
  const branchesSnap = await db.collection('branches').get();
  const branchMap = new Map();
  branchesSnap.forEach((doc) => {
    const data = doc.data();
    const canon = canonicalCoverageName(data.name);
    if (canon) branchMap.set(canon, { id: doc.id, name: canon });
  });

  const reportsSnap = await db.collection('reports').get();
  console.log(`Found ${reportsSnap.size} reports to inspect.`);

  let updatedCount = 0;

  for (const doc of reportsSnap.docs) {
    const report = doc.data();
    const lat = Number(report.location?.latitude);
    const lng = Number(report.location?.longitude);

    let resolvedBarangay = report.routingBarangay || '';

    // If coordinates exist, point-in-polygon is the most authoritative truth
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const poly = findBarangayByCoordinates(lat, lng);
      if (poly?.name) {
        resolvedBarangay = poly.name;
      }
    }

    if (!resolvedBarangay) {
      resolvedBarangay = canonicalCoverageName(report.location?.barangay) || '';
    }

    if (!resolvedBarangay) {
      console.log(`Skipping report ${doc.id}: unable to resolve barangay.`);
      continue;
    }

    const branch = branchMap.get(resolvedBarangay) || { id: null, name: resolvedBarangay };

    const updatePayload = {
      routingBarangay: resolvedBarangay,
      routingBranchId: branch.id,
      routingBranchName: branch.name,
      'location.barangay': resolvedBarangay,
    };

    await doc.ref.update(updatePayload);
    updatedCount += 1;
    console.log(`Updated report ${doc.id}: barangay -> ${resolvedBarangay}, branchId -> ${branch.id}`);
  }

  console.log(`\nBackfill complete! Updated ${updatedCount} reports.`);
  process.exit(0);
}

backfill().catch((err) => {
  console.error('Backfill error:', err);
  process.exit(1);
});
