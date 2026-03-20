import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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

function InvalidateMapSize({ expandKey }) {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 60);

    return () => clearTimeout(timer);
  }, [map, expandKey]);

  return null;
}

function MapCanvas({ selectedPosition, safeMarkers, tileSource, handleTileError, onPick, expandKey, activeMarkerId, onMarkerClick }) {
  return (
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
      <InvalidateMapSize expandKey={expandKey} />
      {safeMarkers.map((marker) => (
        <CircleMarker
          key={marker.id}
          center={marker.position}
          radius={marker.id === activeMarkerId ? 9 : 7}
          pathOptions={{ color: marker.color, fillColor: marker.color, fillOpacity: 0.9, weight: marker.id === activeMarkerId ? 3 : 2 }}
          eventHandlers={{
            click: () => {
              if (onMarkerClick) onMarkerClick(marker);
            },
          }}
        />
      ))}
      <LocationMarker position={selectedPosition} onPick={onPick} />
    </MapContainer>
  );
}

function getMarkerPreviewImage(marker) {
  if (marker?.imageUrl) return marker.imageUrl;
  if (!Array.isArray(marker?.attachments)) return null;

  const imageAttachment = marker.attachments.find((attachment) => {
    const src = String(
      attachment?.secureUrl ||
      attachment?.secure_url ||
      attachment?.url ||
      attachment?.uri ||
      attachment?.downloadURL ||
      attachment?.thumbnailUrl ||
      attachment?.src ||
      ''
    );
    const mime = String(
      attachment?.mimeType ||
      attachment?.mime_type ||
      attachment?.resourceType ||
      attachment?.resource_type ||
      ''
    ).toLowerCase();
    if (!src) return false;
    if (mime.includes('image')) return true;
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(src);
  });

  if (!imageAttachment) return null;
  return (
    imageAttachment.secureUrl ||
    imageAttachment.secure_url ||
    imageAttachment.url ||
    imageAttachment.uri ||
    imageAttachment.downloadURL ||
    imageAttachment.thumbnailUrl ||
    imageAttachment.src ||
    null
  );
}

function MarkerDetailsSidebar({ marker, onClose }) {
  if (!marker) return null;

  const previewImage = getMarkerPreviewImage(marker);

  return (
    <aside className="report-map-sidebar" aria-label="Report details">
      <div className="report-map-sidebar-header">
        <p className="report-map-sidebar-title">Report details</p>
        <button type="button" className="btn-outline report-map-sidebar-close" onClick={onClose} aria-label="Close report details">
          Close
        </button>
      </div>

      <div className="report-map-sidebar-body">
        <h4 className="report-map-sidebar-report-title">{marker.title || 'Untitled report'}</h4>
        <p className="report-map-sidebar-meta">{marker.status ? `Status: ${String(marker.status).replace('_', ' ')}` : 'Status: submitted'}</p>
        {marker.category ? <p className="report-map-sidebar-meta">Category: {marker.category}</p> : null}
        {marker.createdAt ? <p className="report-map-sidebar-meta">Created: {new Date(marker.createdAt).toLocaleString()}</p> : null}
        {marker.address ? <p className="report-map-sidebar-meta">Address: {marker.address}</p> : null}
        {marker.description ? <p className="report-map-sidebar-description">{marker.description}</p> : null}

        {previewImage ? (
          <img src={previewImage} alt={marker.title || 'Report attachment'} className="report-map-sidebar-image" />
        ) : (
          <p className="report-map-sidebar-empty">No image attachment for this report.</p>
        )}
      </div>
    </aside>
  );
}

export default function ReportLocationMap({ lat, lng, onPick, markers = [], helpText = 'Click on the map to pin the report location.' }) {
  const [tileSourceIndex, setTileSourceIndex] = useState(0);
  const [showFullscreenMap, setShowFullscreenMap] = useState(false);
  const [activeMarker, setActiveMarker] = useState(null);

  const selectedPosition = Number.isFinite(lat) && Number.isFinite(lng)
    ? [lat, lng]
    : null;

  const safeMarkers = useMemo(
    () => markers
      .filter((marker) => Number.isFinite(marker?.lat) && Number.isFinite(marker?.lng))
      .map((marker, index) => ({
        ...marker,
        id: marker.id || `${marker.lat}-${marker.lng}-${index}`,
        position: [marker.lat, marker.lng],
        color: marker.color || '#14b8a6',
      })),
    [markers]
  );

  useEffect(() => {
    if (!activeMarker) return;
    const markerStillExists = safeMarkers.some((marker) => marker.id === activeMarker.id);
    if (!markerStillExists) setActiveMarker(null);
  }, [activeMarker, safeMarkers]);

  const tileSource = useMemo(() => TILE_SOURCES[tileSourceIndex] || TILE_SOURCES[0], [tileSourceIndex]);

  const handleTileError = () => {
    setTileSourceIndex((prev) => {
      if (prev >= TILE_SOURCES.length - 1) return prev;
      return prev + 1;
    });
  };

  useEffect(() => {
    if (!showFullscreenMap) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setShowFullscreenMap(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showFullscreenMap]);

  return (
    <>
      <div className="report-map-wrap">
        <div className={`report-map-layout ${activeMarker ? 'report-map-layout-with-sidebar' : ''}`}>
          <div className="report-map-pane">
            <div className="report-map-toolbar">
              <button
                type="button"
                className="btn-outline report-map-expand-btn"
                onClick={() => setShowFullscreenMap(true)}
                aria-label="Open full screen map"
              >
                Full screen map
              </button>
            </div>
            <MapCanvas
              selectedPosition={selectedPosition}
              safeMarkers={safeMarkers}
              tileSource={tileSource}
              handleTileError={handleTileError}
              onPick={onPick}
              expandKey="inline"
              activeMarkerId={activeMarker?.id || null}
              onMarkerClick={setActiveMarker}
            />
          </div>
          <MarkerDetailsSidebar marker={activeMarker} onClose={() => setActiveMarker(null)} />
        </div>
        {helpText ? <p className="report-map-help">{helpText}</p> : null}
      </div>

      {showFullscreenMap && createPortal(
        <div className="report-map-modal" role="dialog" aria-modal="true" aria-label="Full screen map">
          <button
            type="button"
            className="report-map-modal-backdrop"
            aria-label="Close full screen map"
            onClick={() => setShowFullscreenMap(false)}
          />

          <div className="report-map-modal-panel">
            <div className="report-map-modal-header">
              <p className="report-map-modal-title">Map view</p>
              <button
                type="button"
                className="btn-outline report-map-expand-btn"
                onClick={() => setShowFullscreenMap(false)}
                aria-label="Close full screen map"
              >
                Close
              </button>
            </div>

            <div className={`report-map-layout report-map-layout-modal ${activeMarker ? 'report-map-layout-with-sidebar' : ''}`}>
              <div className="report-map-pane">
                <MapCanvas
                  selectedPosition={selectedPosition}
                  safeMarkers={safeMarkers}
                  tileSource={tileSource}
                  handleTileError={handleTileError}
                  onPick={onPick}
                  expandKey="modal"
                  activeMarkerId={activeMarker?.id || null}
                  onMarkerClick={setActiveMarker}
                />
              </div>
              <MarkerDetailsSidebar marker={activeMarker} onClose={() => setActiveMarker(null)} />
            </div>

            {helpText ? <p className="report-map-help">{helpText}</p> : null}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
