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

export const BARANGAY_COLORS = {
  'Asinan': '#0284c7',          // Sky Blue
  'Banicain': '#059669',        // Emerald Green
  'Barretto': '#7c3aed',        // Purple
  'East Bajac-Bajac': '#ea580c',// Tangerine
  'East Tapinac': '#db2777',    // Deep Rose
  'Gordon Heights': '#0d9488',  // Teal
  'Kababae': '#d97706',         // Amber / Gold
  'Kalaklan': '#4f46e5',        // Indigo
  'Kalalake': '#0891b2',        // Cyan
  'Mabayuan': '#65a30d',        // Lime
  'New Cabalan': '#9333ea',     // Orchid
  'New Ilalim': '#e11d48',      // Crimson
  'New Kababae': '#b45309',     // Warm Ochre
  'New Kalalake': '#2563eb',    // Royal Blue
  'Old Cabalan': '#16a34a',     // Green
  'Pag-asa': '#991b1b',         // Dark Red
  'Sta. Rita': '#ca8a04',       // Mustard Gold
  'West Bajac-Bajac': '#dc2626',// Bright Red
  'West Tapinac': '#14b8a6',    // Turquoise
};

const FALLBACK_PALETTE = [
  '#2563eb', '#16a34a', '#d97706', '#9333ea', '#e11d48',
  '#0891b2', '#4f46e5', '#65a30d', '#db2777', '#ea580c',
  '#0d9488', '#0284c7', '#7c3aed', '#059669', '#ca8a04',
  '#dc2626', '#14b8a6', '#991b1b', '#b45309',
];

export function getBarangayColor(value) {
  const canonical = getKnownBarangayName(value);
  if (canonical && BARANGAY_COLORS[canonical]) {
    return BARANGAY_COLORS[canonical];
  }
  const str = String(value || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}
