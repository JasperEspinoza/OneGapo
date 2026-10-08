export const OLONGAPO_BARANGAYS = [
  'Asinan',
  'Banicain',
  'Barretto',
  'East Bajac-Bajac',
  'East Tapinac',
  'Gordon Heights',
  'Kababae',
  'Kalaklan',
  'Kalalake',
  'Mabayuan',
  'New Cabalan',
  'New Ilalim',
  'New Kababae',
  'New Kalalake',
  'Old Cabalan',
  'Pag-asa',
  'Sta. Rita',
  'West Bajac-Bajac',
  'West Tapinac',
];

export function normalizeBarangayToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function getKnownBarangayName(value) {
  const normalized = normalizeBarangayToken(value);
  if (!normalized) return '';

  if (
    normalized === 'new asinan'
    || normalized.includes('new asinan')
    || normalized === 'poblacion'
    || normalized.includes('poblacion')
  ) {
    return 'Asinan';
  }
  if (normalized === 'santa rita') return 'Sta. Rita';

  const exact = OLONGAPO_BARANGAYS.find(
    (name) => normalizeBarangayToken(name) === normalized
  );
  if (exact) return exact;

  return OLONGAPO_BARANGAYS.find((name) => (
    normalized.includes(normalizeBarangayToken(name))
  )) || '';
}
