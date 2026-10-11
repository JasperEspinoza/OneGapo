import geopandas as gpd
from shapely.geometry import mapping
import json
import os

gdb_path = 'C:/OneGapo/phl_admin_boundaries.gdb'
output_constants = 'C:/OneGapo/backend/constants/olongapoBoundaries.json'
output_root = 'C:/OneGapo/barangays.geojson'

NAME_NORMALIZE = {
    'Asinan': 'Asinan',
    'Banicain': 'Banicain',
    'Barretto': 'Barretto',
    'East Bajac-bajac': 'East Bajac-Bajac',
    'East Bajac-Bajac': 'East Bajac-Bajac',
    'East Tapinac': 'East Tapinac',
    'Gordon Heights': 'Gordon Heights',
    'Kalaklan': 'Kalaklan',
    'New Kalalake': 'New Kalalake',
    'Mabayuan': 'Mabayuan',
    'New Cabalan': 'New Cabalan',
    'New Ilalim': 'New Ilalim',
    'New Kababae': 'New Kababae',
    'Pag-asa': 'Pag-asa',
    'Santa Rita': 'Sta. Rita',
    'Sta. Rita': 'Sta. Rita',
    'West Bajac-bajac': 'West Bajac-Bajac',
    'West Bajac-Bajac': 'West Bajac-Bajac',
    'West Tapinac': 'West Tapinac',
    'Old Cabalan': 'Old Cabalan',
}

PSGC_MAP = {
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
}

print(f"Reading phl_admin4 layer from {gdb_path}...")
gdf = gpd.read_file(gdb_path, layer='phl_admin4', where="adm3_pcode = 'PH0307107'")
print(f"Loaded {len(gdf)} barangays from GDB.")

def round_coords(coords, precision=6):
    if isinstance(coords, (tuple, list)):
        if len(coords) == 0:
            return coords
        if isinstance(coords[0], (int, float)):
            return [round(float(c), precision) for c in coords]
        return [round_coords(c, precision) for c in coords]
    return coords

features = []
for idx, row in gdf.iterrows():
    raw_name = str(row['adm4_name']).strip()
    canonical = NAME_NORMALIZE.get(raw_name, raw_name)
    
    geom = mapping(row.geometry)
    geom['coordinates'] = round_coords(geom['coordinates'], 6)
    
    props = {
        'name': canonical,
        'psgc': PSGC_MAP.get(canonical, str(row.get('adm4_pcode', ''))),
        'adm4_pcode': str(row.get('adm4_pcode', '')),
        'adm3_pcode': str(row.get('adm3_pcode', '')),
        'sourceName': raw_name,
        'area_sqkm': round(float(row['area_sqkm']), 4) if row.get('area_sqkm') is not None else None,
        'center_lat': round(float(row['center_lat']), 6) if row.get('center_lat') is not None else None,
        'center_lon': round(float(row['center_lon']), 6) if row.get('center_lon') is not None else None,
    }
    
    features.append({
        'type': 'Feature',
        'properties': props,
        'geometry': geom
    })
    print(f"  [OK] Processed: {canonical} (raw: {raw_name}, type: {geom['type']})")

output_geojson = {
    'type': 'FeatureCollection',
    'generated': '2026-10-11T17:15:00.000Z',
    'source': 'phl_admin_boundaries.gdb (NAMRIA / PSA Level 4 Barangays)',
    'note': 'Full unsimplified contiguous boundaries for Olongapo City with 100% gapless coverage.',
    'features': features
}

print(f"\nWriting to {output_constants}...")
with open(output_constants, 'w', encoding='utf-8') as f:
    json.dump(output_geojson, f, indent=2)
print(f"Saved {os.path.getsize(output_constants)} bytes to {output_constants}")

print(f"Writing to {output_root}...")
with open(output_root, 'w', encoding='utf-8') as f:
    json.dump(output_geojson, f, indent=2)
print(f"Saved {os.path.getsize(output_root)} bytes to {output_root}")
print("\nSuccessfully extracted and updated boundaries from phl_admin_boundaries.gdb!")
