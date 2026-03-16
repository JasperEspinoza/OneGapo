import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const defaultCenter = [14.8386, 120.2842];

const TILE_SOURCES = [
  {
    id: 'osm',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    id: 'carto',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
];

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function LocationMarker({ position, onPick }) {
  useMapEvents({
    click(event) {
      const { lat, lng } = event.latlng;
      onPick({ lat, lng });
    },
  });

  if (!position) return null;

  return <Marker position={position} />;
}

function RecenterOnPosition({ position }) {
  const map = useMap();

  useEffect(() => {
    if (!position) return;
    map.setView(position, 16, { animate: true });
  }, [map, position]);

  return null;
}

export default function ReportLocationMap({ lat, lng, onPick }) {
  const [tileSourceIndex, setTileSourceIndex] = useState(0);

  const selectedPosition = Number.isFinite(lat) && Number.isFinite(lng)
    ? [lat, lng]
    : null;

  const tileSource = useMemo(() => TILE_SOURCES[tileSourceIndex] || TILE_SOURCES[0], [tileSourceIndex]);

  const handleTileError = () => {
    setTileSourceIndex((prev) => {
      if (prev >= TILE_SOURCES.length - 1) return prev;
      return prev + 1;
    });
  };

  return (
    <div className="report-map-wrap">
      <MapContainer
        center={selectedPosition || defaultCenter}
        zoom={selectedPosition ? 16 : 13}
        scrollWheelZoom
        className="report-map"
      >
        <TileLayer
          attribution={tileSource.attribution}
          url={tileSource.url}
          eventHandlers={{
            tileerror: handleTileError,
          }}
        />
        <RecenterOnPosition position={selectedPosition} />
        <LocationMarker position={selectedPosition} onPick={onPick} />
      </MapContainer>
      <p className="report-map-help">Click on the map to pin the report location.</p>
    </div>
  );
}
