import { CircleMarker, MapContainer, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
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

const REPORT_CATEGORY_LEGEND = [
  { key: 'infrastructure', label: 'Infrastructure', color: '#f59e0b' },
  { key: 'safety', label: 'Public Safety', color: '#ef4444' },
  { key: 'sanitation', label: 'Sanitation', color: '#0ea5e9' },
  { key: 'disaster', label: 'Disaster / Emergency', color: '#dc2626' },
  { key: 'general', label: 'General Concern', color: '#14b8a6' },
];

const REPORT_CATEGORY_COLOR_BY_KEY = REPORT_CATEGORY_LEGEND.reduce((acc, item) => {
  acc[item.key] = item.color;
  return acc;
}, {});

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

function RecenterOnMarkers({ markers, disabled, freezeAfterFirstFit = false }) {
  const map = useMap();
  const hasAutoFittedRef = useRef(false);

  useEffect(() => {
    if (markers.length === 0) {
      hasAutoFittedRef.current = false;
      return;
    }

    if (disabled || markers.length === 0) return;
    if (freezeAfterFirstFit && hasAutoFittedRef.current) return;

    if (markers.length === 1) {
      map.setView(markers[0].position, 15, { animate: true });
      hasAutoFittedRef.current = true;
      return;
    }

    const bounds = L.latLngBounds(markers.map((marker) => marker.position));
    map.fitBounds(bounds, { padding: [28, 28] });
    hasAutoFittedRef.current = true;
  }, [disabled, freezeAfterFirstFit, map, markers]);

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

function formatRouteDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) return '--';
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function formatRouteDuration(durationSeconds) {
  if (!Number.isFinite(durationSeconds)) return '--';
  const totalMinutes = Math.round(durationSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function MapCanvas({ selectedPosition, safeMarkers, tileSource, handleTileError, onPick, expandKey, activeMarkerId, onMarkerClick, routePath, userPosition, freezeMarkerAutoFit }) {
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
      <RecenterOnMarkers markers={safeMarkers} disabled={Boolean(selectedPosition)} freezeAfterFirstFit={freezeMarkerAutoFit} />
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
      {userPosition ? (
        <CircleMarker
          center={userPosition}
          radius={7}
          pathOptions={{ color: '#1d4ed8', fillColor: '#1d4ed8', fillOpacity: 0.92, weight: 2 }}
        />
      ) : null}
      {routePath.length > 1 ? (
        <Polyline positions={routePath} pathOptions={{ color: '#1d4ed8', weight: 4, opacity: 0.85 }} />
      ) : null}
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

function MarkerDetailsSidebar({ marker, onClose, onOpenImage, onBuildRoute, onClearRoute, routeLoading, routeError, routeSummary, routeAvailable, isClosing = false }) {
  if (!marker) return null;

  const previewImage = getMarkerPreviewImage(marker);

  return (
    <aside
      key={marker.id}
      className={`report-map-sidebar report-map-sidebar-animated${isClosing ? ' report-map-sidebar-closing' : ''}`}
      aria-label="Report details"
    >
      <div className="report-map-sidebar-header">
        <p className="report-map-sidebar-title">Report details</p>
        <button type="button" className="btn-outline report-map-sidebar-close" onClick={onClose} aria-label="Close report details">
          X
        </button>
      </div>

      <div className="report-map-sidebar-body">
        <h4 className="report-map-sidebar-report-title">{marker.title || 'Untitled report'}</h4>
        <p className="report-map-sidebar-meta">{marker.status ? `Status: ${String(marker.status).replace('_', ' ')}` : 'Status: submitted'}</p>
        {marker.category ? <p className="report-map-sidebar-meta">Category: {marker.category}</p> : null}
        {marker.createdAt ? <p className="report-map-sidebar-meta">Created: {new Date(marker.createdAt).toLocaleString()}</p> : null}
        {marker.address ? <p className="report-map-sidebar-meta">Address: {marker.address}</p> : null}
        {marker.description ? <p className="report-map-sidebar-description">{marker.description}</p> : null}

        <div className="report-map-route-actions">
          <button
            type="button"
            className="btn-outline report-map-route-btn"
            onClick={onBuildRoute}
            disabled={routeLoading}
          >
            {routeLoading ? 'Routing...' : 'Route from my location'}
          </button>
          {routeAvailable ? (
            <button
              type="button"
              className="btn-outline report-map-route-btn"
              onClick={onClearRoute}
            >
              Clear route
            </button>
          ) : null}
        </div>

        {routeSummary ? (
          <p className="report-map-route-summary">
            Distance: {formatRouteDistance(routeSummary.distance)} | ETA: {formatRouteDuration(routeSummary.duration)}
          </p>
        ) : null}

        {routeError ? <p className="report-map-route-error">{routeError}</p> : null}

        {previewImage ? (
          <>
            <button
              type="button"
              className="report-map-sidebar-image-button"
              onClick={() => onOpenImage(previewImage, marker.title || 'Report attachment')}
              aria-label="Open report image in full view"
            >
              <img src={previewImage} alt={marker.title || 'Report attachment'} className="report-map-sidebar-image" />
              <span className="material-symbols-outlined report-map-sidebar-image-icon" aria-hidden="true">zoom_in</span>
            </button>
          </>
        ) : (
          <p className="report-map-sidebar-empty">No image attachment for this report.</p>
        )}
      </div>
    </aside>
  );
}

export default function ReportLocationMap({ lat, lng, onPick, markers = [], helpText = 'Click on the map to pin the report location.', preserveViewOnRefresh = false }) {
  const [tileSourceIndex, setTileSourceIndex] = useState(0);
  const [showFullscreenMap, setShowFullscreenMap] = useState(false);
  const [activeMarker, setActiveMarker] = useState(null);
  const [sidebarClosing, setSidebarClosing] = useState(false);
  const [zoomedImage, setZoomedImage] = useState(null);
  const [userPosition, setUserPosition] = useState(null);
  const [routePath, setRoutePath] = useState([]);
  const [routeSummary, setRouteSummary] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  const sidebarCloseTimeoutRef = useRef(null);

  const selectedPosition = Number.isFinite(lat) && Number.isFinite(lng)
    ? [lat, lng]
    : null;

  const safeMarkers = useMemo(
    () => markers
      .filter((marker) => Number.isFinite(marker?.lat) && Number.isFinite(marker?.lng))
      .map((marker, index) => {
        const categoryKey = String(marker?.category || 'general').toLowerCase().trim() || 'general';

        return {
          ...marker,
          id: marker.id || `${marker.lat}-${marker.lng}-${index}`,
          position: [marker.lat, marker.lng],
          color: marker.color || REPORT_CATEGORY_COLOR_BY_KEY[categoryKey] || '#14b8a6',
          category: categoryKey,
        };
      }),
    [markers]
  );

  const markerLegendItems = useMemo(() => {
    const legendMap = new Map(
      REPORT_CATEGORY_LEGEND.map((item) => [item.key, { ...item, count: 0 }])
    );

    safeMarkers.forEach((marker) => {
      const key = String(marker?.category || 'general').toLowerCase().trim() || 'general';
      const current = legendMap.get(key);

      if (current) {
        current.count += 1;
        return;
      }

      legendMap.set(key, {
        key,
        label: key.replace(/_/g, ' '),
        color: marker.color || '#14b8a6',
        count: 1,
      });
    });

    return Array.from(legendMap.values());
  }, [safeMarkers]);

  useEffect(() => {
    if (!activeMarker) return;
    const updatedMarker = safeMarkers.find((marker) => marker.id === activeMarker.id);
    if (!updatedMarker) {
      setActiveMarker(null);
      return;
    }

    if (updatedMarker !== activeMarker) {
      setActiveMarker(updatedMarker);
    }
  }, [activeMarker, safeMarkers]);

  useEffect(() => {
    if (activeMarker) return;
    setRoutePath([]);
    setRouteSummary(null);
    setRouteError('');
    setRouteLoading(false);
  }, [activeMarker]);

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

  useEffect(() => () => {
    if (sidebarCloseTimeoutRef.current) {
      window.clearTimeout(sidebarCloseTimeoutRef.current);
      sidebarCloseTimeoutRef.current = null;
    }
  }, []);

  const handleMarkerSelect = (marker) => {
    if (sidebarCloseTimeoutRef.current) {
      window.clearTimeout(sidebarCloseTimeoutRef.current);
      sidebarCloseTimeoutRef.current = null;
    }

    setSidebarClosing(false);
    setActiveMarker(marker);
  };

  const handleSidebarClose = () => {
    if (!activeMarker || sidebarClosing) return;

    setSidebarClosing(true);
    sidebarCloseTimeoutRef.current = window.setTimeout(() => {
      setActiveMarker(null);
      setSidebarClosing(false);
      sidebarCloseTimeoutRef.current = null;
    }, 170);
  };

  const openImagePreview = (src, alt) => {
    if (!src) return;
    setZoomedImage({ src, alt: alt || 'Report attachment' });
  };

  const handleBuildRoute = async () => {
    if (!activeMarker || !Number.isFinite(activeMarker?.lat) || !Number.isFinite(activeMarker?.lng)) return;
    if (!navigator.geolocation) {
      setRouteError('Geolocation is not available in this browser.');
      return;
    }

    setRouteLoading(true);
    setRouteError('');

    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });

      const originLat = position.coords.latitude;
      const originLng = position.coords.longitude;
      setUserPosition([originLat, originLng]);

      const destinationLat = Number(activeMarker.lat);
      const destinationLng = Number(activeMarker.lng);

      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destinationLng},${destinationLat}?overview=full&geometries=geojson`
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) {
        throw new Error('Could not generate route right now.');
      }

      const bestRoute = data.routes[0];
      const coordinates = Array.isArray(bestRoute?.geometry?.coordinates)
        ? bestRoute.geometry.coordinates
        : [];

      if (coordinates.length < 2) {
        throw new Error('Route geometry is unavailable for this destination.');
      }

      const latLngPath = coordinates
        .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
        .map((point) => [point[1], point[0]]);

      setRoutePath(latLngPath);
      setRouteSummary({
        distance: Number(bestRoute.distance),
        duration: Number(bestRoute.duration),
      });
    } catch (err) {
      setRoutePath([]);
      setRouteSummary(null);
      setRouteError(err?.message || 'Failed to compute route.');
    } finally {
      setRouteLoading(false);
    }
  };

  const handleClearRoute = () => {
    setRoutePath([]);
    setRouteSummary(null);
    setRouteError('');
  };

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
              onMarkerClick={handleMarkerSelect}
              routePath={routePath}
              userPosition={userPosition}
              freezeMarkerAutoFit={preserveViewOnRefresh}
            />
          </div>
          <MarkerDetailsSidebar
            marker={activeMarker}
            onClose={handleSidebarClose}
            onOpenImage={openImagePreview}
            onBuildRoute={handleBuildRoute}
            onClearRoute={handleClearRoute}
            routeLoading={routeLoading}
            routeError={routeError}
            routeSummary={routeSummary}
            routeAvailable={routePath.length > 1}
            isClosing={sidebarClosing}
          />
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
                X
              </button>
            </div>

            <div className="report-map-modal-content">
              <div className="report-map-layout report-map-layout-modal">
                <div className="report-map-pane">
                  <MapCanvas
                    selectedPosition={selectedPosition}
                    safeMarkers={safeMarkers}
                    tileSource={tileSource}
                    handleTileError={handleTileError}
                    onPick={onPick}
                    expandKey="modal"
                    activeMarkerId={activeMarker?.id || null}
                    onMarkerClick={handleMarkerSelect}
                    routePath={routePath}
                    userPosition={userPosition}
                    freezeMarkerAutoFit={preserveViewOnRefresh}
                  />

                  {markerLegendItems.length > 0 ? (
                    <div className="report-map-fullscreen-legend" aria-label="Map report color legend">
                      <p className="report-map-fullscreen-legend-title">Report colors</p>
                      <ul className="report-map-fullscreen-legend-list">
                        {markerLegendItems.map((item) => (
                          <li key={item.key} className="report-map-fullscreen-legend-item">
                            <span className="report-map-fullscreen-legend-dot" style={{ backgroundColor: item.color }} aria-hidden="true" />
                            <span className="report-map-fullscreen-legend-label">{item.label}</span>
                            <span className="report-map-fullscreen-legend-count">{item.count}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>

              {activeMarker ? (
                <div className="report-map-modal-sidebar-shell">
                  <MarkerDetailsSidebar
                    marker={activeMarker}
                    onClose={handleSidebarClose}
                    onOpenImage={openImagePreview}
                    onBuildRoute={handleBuildRoute}
                    onClearRoute={handleClearRoute}
                    routeLoading={routeLoading}
                    routeError={routeError}
                    routeSummary={routeSummary}
                    routeAvailable={routePath.length > 1}
                    isClosing={sidebarClosing}
                  />
                </div>
              ) : null}
            </div>

            {helpText ? <p className="report-map-help">{helpText}</p> : null}
          </div>
        </div>,
        document.body
      )}

      {zoomedImage && createPortal(
        <div className="report-image-modal" role="dialog" aria-modal="true" aria-label="Expanded report image">
          <button
            type="button"
            className="report-image-modal-backdrop"
            onClick={() => setZoomedImage(null)}
            aria-label="Close expanded image"
          />
          <div className="report-image-modal-panel">
            <button
              type="button"
              className="btn-outline report-image-modal-close"
              onClick={() => setZoomedImage(null)}
              aria-label="Close expanded image"
            >
              X
            </button>
            <img src={zoomedImage.src} alt={zoomedImage.alt} className="report-image-modal-image" />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
