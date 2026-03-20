import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import 'leaflet/dist/leaflet.css';

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

function LocationMarker({ position, onPick }) {
  if (!onPick) {
    return position ? (
      <CircleMarker
        center={position}
        radius={8}
        pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.9, weight: 2 }}
      />
    ) : null;
  }

  useMapEvents({
    click(event) {
      const { lat, lng } = event.latlng;
      onPick({ lat, lng });
    },
  });

  if (!position) return null;

  return (
    <CircleMarker
      center={position}
      radius={8}
      pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.9, weight: 2 }}
    />
  );
}

function RecenterOnPosition({ position }) {
  const map = useMap();

  useEffect(() => {
    if (!position) return;
    map.setView(position, 16, { animate: true });
  }, [map, position]);

  return null;
}

function RecenterOnMarkers({ markers, disabled }) {
  const map = useMap();

  useEffect(() => {
    if (disabled || markers.length === 0) return;

    if (markers.length === 1) {
      map.setView(markers[0].position, 15, { animate: true });
      return;
    }

    const bounds = L.latLngBounds(markers.map((marker) => marker.position));
    map.fitBounds(bounds, { padding: [28, 28] });
  }, [disabled, map, markers]);

  return null;
}

export default function ReportLocationMap({ lat, lng, onPick, markers = [], helpText = 'Click on the map to pin the report location.' }) {
  const [tileSourceIndex, setTileSourceIndex] = useState(0);

  const selectedPosition = Number.isFinite(lat) && Number.isFinite(lng)
    ? [lat, lng]
    : null;

  const safeMarkers = useMemo(
    () => markers
      .filter((marker) => Number.isFinite(marker?.lat) && Number.isFinite(marker?.lng))
      .map((marker, index) => ({
        id: marker.id || `${marker.lat}-${marker.lng}-${index}`,
        position: [marker.lat, marker.lng],
        color: marker.color || '#14b8a6',
      })),
    [markers]
  );

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
        center={selectedPosition || safeMarkers[0]?.position || defaultCenter}
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
        <RecenterOnMarkers markers={safeMarkers} disabled={Boolean(selectedPosition)} />
        {safeMarkers.map((marker) => (
          <CircleMarker
            key={marker.id}
            center={marker.position}
            radius={7}
            pathOptions={{ color: marker.color, fillColor: marker.color, fillOpacity: 0.82, weight: 2 }}
          />
        ))}
        <LocationMarker position={selectedPosition} onPick={onPick} />
      </MapContainer>
      {helpText ? <p className="report-map-help">{helpText}</p> : null}
    </div>
  );
}
