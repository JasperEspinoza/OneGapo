import { CircleMarker, MapContainer, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';

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
  { key: 'infrastructure', label: 'Infrastructure', color: '#2E7D32' },
  { key: 'safety', label: 'Public Safety', color: '#D32F2F' },
  { key: 'sanitation', label: 'Sanitation', color: '#F59E0B' },
  { key: 'disaster', label: 'Disaster / Emergency', color: '#1976D2' },
  { key: 'general', label: 'General Concern', color: '#7B1FA2' },
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

const OLONGAPO_BARANGAYS = [
  'Asinan',
  'Bajac-Bajac',
  'Barretto',
  'East Bajac-Bajac',
  'East Tapinac',
  'Gordon Heights',
  'Kalaklan',
  'Mabayuan',
  'New Cabalan',
  'New Ilalim',
  'New Kababae',
  'New Kalalake',
  'Old Cabalan',
  'Pag-asa',
  'Santa Rita',
  'West Bajac-Bajac',
  'West Tapinac',
];

const BARANGAY_BY_NORMALIZED = new Map(
  OLONGAPO_BARANGAYS.map((name) => [
    String(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
    name,
  ])
);

function normalizeBarangayToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toTitleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getKnownBarangayName(value) {
  const normalized = normalizeBarangayToken(value);
  if (!normalized) return '';

  const exact = BARANGAY_BY_NORMALIZED.get(normalized);
  if (exact) return exact;

  const partial = OLONGAPO_BARANGAYS.find((name) => {
    const known = normalizeBarangayToken(name);
    return normalized.includes(known);
  });

  return partial || '';
}

function extractBarangayFromMarker(marker) {
  const directBarangay = String(
    marker?.barangay || marker?.location?.barangay || ''
  ).trim();

  if (directBarangay) {
    const cleaned = directBarangay.replace(/^(?:brgy\.?|barangay)\s+/i, '').trim();
    return getKnownBarangayName(cleaned) || toTitleCase(cleaned);
  }

  const address = String(marker?.address || marker?.location?.address || '').trim();
  if (!address) return '';

  const fromPrefixMatch = address.match(/(?:^|,|\s)(?:brgy\.?|barangay)\s+([^,;]+)/i);
  if (fromPrefixMatch?.[1]) {
    const cleaned = fromPrefixMatch[1].trim();
    return getKnownBarangayName(cleaned) || toTitleCase(cleaned);
  }

  const addressSegments = address
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of addressSegments) {
    const cleaned = segment
      .replace(/\b(city of olongapo|olongapo city|olongapo|zambales|philippines)\b/gi, '')
      .replace(/^(?:brgy\.?|barangay)\s+/i, '')
      .trim();

    const known = getKnownBarangayName(cleaned);
    if (known) return known;
  }

  const knownFromWholeAddress = getKnownBarangayName(address);
  if (knownFromWholeAddress) return knownFromWholeAddress;

  return '';
}

function getHeatPointWeight(marker) {
  const category = String(marker?.category || 'general').toLowerCase();
  if (category === 'disaster') return 1;
  if (category === 'safety') return 0.95;
  if (category === 'sanitation') return 0.75;
  if (category === 'infrastructure') return 0.7;
  return 0.55;
}

function hexToRgba(hex, alpha) {
  const raw = String(hex || '').replace('#', '').trim();
  const normalized = raw.length === 3
    ? raw.split('').map((char) => `${char}${char}`).join('')
    : raw;

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `rgba(20, 184, 166, ${alpha})`;
  }

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function HeatmapLayer({ markers, enabled }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled || !Array.isArray(markers) || markers.length === 0) {
      return undefined;
    }

    if (typeof L.heatLayer !== 'function') {
      return undefined;
    }

    const pointsByCategory = markers.reduce((acc, marker) => {
      const lat = Number(marker?.lat);
      const lng = Number(marker?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return acc;

      const category = String(marker?.category || 'general').toLowerCase().trim() || 'general';
      const color = marker?.color || REPORT_CATEGORY_COLOR_BY_KEY[category] || '#14b8a6';

      if (!acc[category]) {
        acc[category] = {
          color,
          points: [],
        };
      }

      acc[category].points.push([lat, lng, getHeatPointWeight(marker)]);
      return acc;
    }, {});

    const categoryEntries = Object.values(pointsByCategory).filter((entry) => entry.points.length > 0);
    if (categoryEntries.length === 0) {
      return undefined;
    }

    const heatLayers = categoryEntries.map((entry) => {
      return L.heatLayer(entry.points, {
        radius: 24,
        blur: 16,
        maxZoom: 18,
        minOpacity: 0.2,
        gradient: {
          0.15: hexToRgba(entry.color, 0.08),
          0.45: hexToRgba(entry.color, 0.28),
          0.75: hexToRgba(entry.color, 0.58),
          1.0: entry.color,
        },
      }).addTo(map);
    });

    return () => {
      heatLayers.forEach((layer) => {
        map.removeLayer(layer);
      });
    };
  }, [enabled, map, markers]);

  return null;
}

function MapCanvas({ selectedPosition, safeMarkers, autoFitMarkers, tileSource, handleTileError, onPick, expandKey, activeMarkerId, onMarkerClick, routePath, userPosition, freezeMarkerAutoFit, showHeatmap }) {
  const initialMarkers = autoFitMarkers.length > 0 ? autoFitMarkers : safeMarkers;

  return (
    <MapContainer
      center={selectedPosition || initialMarkers[0]?.position || defaultCenter}
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
      <RecenterOnMarkers markers={initialMarkers} disabled={Boolean(selectedPosition)} freezeAfterFirstFit={freezeMarkerAutoFit} />
      <InvalidateMapSize expandKey={expandKey} />
      <HeatmapLayer markers={safeMarkers} enabled={showHeatmap} />
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

function MarkerDetailsSidebar({
  marker,
  onClose,
  onOpenImage,
  onBuildRoute,
  onClearRoute,
  routeLoading,
  routeError,
  routeSummary,
  routeAvailable,
  statusOptions,
  canUpdateStatus,
  updatingStatusForId,
  onStatusChange,
  isClosing = false,
}) {
  if (!marker) return null;

  const previewImage = getMarkerPreviewImage(marker);
  const markerStatus = String(marker?.status || 'submitted').toLowerCase();
  const isStatusUpdating = Boolean(updatingStatusForId && updatingStatusForId === marker.id);

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
        {canUpdateStatus ? (
          <div className="report-map-status-actions">
            <label htmlFor={`report-map-status-${marker.id}`} className="report-map-status-label">Update status</label>
            <select
              id={`report-map-status-${marker.id}`}
              className="form-select report-map-status-select"
              value={markerStatus}
              onChange={(event) => onStatusChange?.(marker.id, event.target.value)}
              disabled={isStatusUpdating}
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        ) : null}
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

export default function ReportLocationMap({
  lat,
  lng,
  onPick,
  markers = [],
  preferredBarangay = '',
  helpText = 'Click on the map to pin the report location.',
  preserveViewOnRefresh = false,
  enableFullscreenBarangayFilter = true,
  statusOptions = [],
  onStatusChange,
  canUpdateStatus = false,
  updatingStatusForId = '',
  focusMarkerId = '',
  autoRouteRequestKey = 0,
  enableHeatmapToggle = false,
  enableCategoryFilter = false,
}) {
  const [tileSourceIndex, setTileSourceIndex] = useState(0);
  const [showFullscreenMap, setShowFullscreenMap] = useState(false);
  const [fullscreenBarangayFilter, setFullscreenBarangayFilter] = useState('all');
  const [activeMarker, setActiveMarker] = useState(null);
  const [sidebarClosing, setSidebarClosing] = useState(false);
  const [zoomedImage, setZoomedImage] = useState(null);
  const [userPosition, setUserPosition] = useState(null);
  const [routePath, setRoutePath] = useState([]);
  const [routeSummary, setRouteSummary] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const sidebarCloseTimeoutRef = useRef(null);
  const lastAppliedFocusIdRef = useRef('');
  const lastAutoRouteRequestKeyRef = useRef(0);

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

  const categoryFilterOptions = useMemo(() => {
    const available = new Set(safeMarkers.map((marker) => String(marker?.category || 'general').toLowerCase()));
    return REPORT_CATEGORY_LEGEND.filter((item) => available.has(item.key));
  }, [safeMarkers]);

  const categoryFilteredMarkers = useMemo(() => {
    if (categoryFilter === 'all') return safeMarkers;
    return safeMarkers.filter((marker) => String(marker?.category || 'general').toLowerCase() === categoryFilter);
  }, [categoryFilter, safeMarkers]);

  const markerLegendItems = useMemo(() => {
    const shouldApplyBarangayFilter = enableFullscreenBarangayFilter && fullscreenBarangayFilter !== 'all';
    const legendMarkers = showFullscreenMap
      ? (shouldApplyBarangayFilter
          ? categoryFilteredMarkers.filter((marker) => extractBarangayFromMarker(marker) === fullscreenBarangayFilter)
          : categoryFilteredMarkers)
      : categoryFilteredMarkers;

    const legendMap = new Map(
      REPORT_CATEGORY_LEGEND.map((item) => [item.key, { ...item, count: 0 }])
    );

    legendMarkers.forEach((marker) => {
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
  }, [categoryFilteredMarkers, showFullscreenMap, enableFullscreenBarangayFilter, fullscreenBarangayFilter]);

  const fullscreenBarangayOptions = useMemo(() => {
    return Array.from(
      new Set(
        categoryFilteredMarkers
          .map((marker) => extractBarangayFromMarker(marker))
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [categoryFilteredMarkers]);

  const fullscreenFilteredMarkers = useMemo(() => {
    if (!enableFullscreenBarangayFilter || fullscreenBarangayFilter === 'all') return categoryFilteredMarkers;
    return categoryFilteredMarkers.filter((marker) => extractBarangayFromMarker(marker) === fullscreenBarangayFilter);
  }, [categoryFilteredMarkers, enableFullscreenBarangayFilter, fullscreenBarangayFilter]);

  const preferredBarangayToken = useMemo(
    () => normalizeBarangayToken(preferredBarangay),
    [preferredBarangay]
  );

  const getAutoFitMarkers = useCallback((markerList) => {
    if (!preferredBarangayToken || !Array.isArray(markerList) || markerList.length === 0) {
      return markerList;
    }

    const focused = markerList.filter(
      (marker) => normalizeBarangayToken(extractBarangayFromMarker(marker)) === preferredBarangayToken
    );

    return focused.length > 0 ? focused : markerList;
  }, [preferredBarangayToken]);

  const inlineAutoFitMarkers = useMemo(
    () => getAutoFitMarkers(categoryFilteredMarkers),
    [categoryFilteredMarkers, getAutoFitMarkers]
  );

  const fullscreenAutoFitMarkers = useMemo(
    () => getAutoFitMarkers(fullscreenFilteredMarkers),
    [getAutoFitMarkers, fullscreenFilteredMarkers]
  );

  useEffect(() => {
    if (!activeMarker) return;
    const updatedMarker = categoryFilteredMarkers.find((marker) => marker.id === activeMarker.id);
    if (!updatedMarker) {
      setActiveMarker(null);
      return;
    }

    if (updatedMarker !== activeMarker) {
      setActiveMarker(updatedMarker);
    }
  }, [activeMarker, categoryFilteredMarkers]);

  useEffect(() => {
    if (!showFullscreenMap || !activeMarker) return;
    if (!enableFullscreenBarangayFilter || fullscreenBarangayFilter === 'all') return;

    const stillVisible = fullscreenFilteredMarkers.some((marker) => marker.id === activeMarker.id);
    if (!stillVisible) {
      setActiveMarker(null);
      setSidebarClosing(false);
    }
  }, [showFullscreenMap, activeMarker, enableFullscreenBarangayFilter, fullscreenBarangayFilter, fullscreenFilteredMarkers]);

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

  const buildRouteForMarker = useCallback(async (marker) => {
    if (!marker || !Number.isFinite(marker?.lat) || !Number.isFinite(marker?.lng)) return;
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

      const destinationLat = Number(marker.lat);
      const destinationLng = Number(marker.lng);

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
  }, []);

  const handleBuildRoute = async () => {
    await buildRouteForMarker(activeMarker);
  };

  useEffect(() => {
    const markerId = String(focusMarkerId || '').trim();
    if (!markerId) return;
    if (markerId === lastAppliedFocusIdRef.current) return;

    const anyMarker = safeMarkers.find((marker) => String(marker?.id || '') === markerId);
    if (!anyMarker) return;
    if (categoryFilter !== 'all' && anyMarker.category !== categoryFilter) {
      setCategoryFilter('all');
    }

    const targetMarker = anyMarker;
    if (!targetMarker) return;

    if (sidebarCloseTimeoutRef.current) {
      window.clearTimeout(sidebarCloseTimeoutRef.current);
      sidebarCloseTimeoutRef.current = null;
    }

    setSidebarClosing(false);
    setActiveMarker(targetMarker);
    lastAppliedFocusIdRef.current = markerId;
  }, [categoryFilter, focusMarkerId, safeMarkers]);

  useEffect(() => {
    const markerId = String(focusMarkerId || '').trim();
    if (!markerId || !autoRouteRequestKey) return;
    if (autoRouteRequestKey === lastAutoRouteRequestKeyRef.current) return;

    const targetMarker = safeMarkers.find((marker) => String(marker?.id || '') === markerId);
    if (!targetMarker) return;

    if (categoryFilter !== 'all' && targetMarker.category !== categoryFilter) {
      setCategoryFilter('all');
    }

    lastAutoRouteRequestKeyRef.current = autoRouteRequestKey;
    setActiveMarker(targetMarker);
    buildRouteForMarker(targetMarker);
  }, [autoRouteRequestKey, buildRouteForMarker, categoryFilter, focusMarkerId, safeMarkers]);

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
              {enableCategoryFilter ? (
                <>
                  <select
                    id="inline-category-filter"
                    className="form-select report-map-filter-select"
                    value={categoryFilter}
                    onChange={(event) => setCategoryFilter(event.target.value)}
                    aria-label="Filter by report category"
                  >
                    <option value="all">All categories</option>
                    {categoryFilterOptions.map((item) => (
                      <option key={item.key} value={item.key}>{item.label}</option>
                    ))}
                  </select>
                </>
              ) : null}
              {enableHeatmapToggle ? (
                <button
                  type="button"
                  className="btn-outline report-map-expand-btn"
                  onClick={() => setHeatmapEnabled((prev) => !prev)}
                  aria-pressed={heatmapEnabled}
                >
                  Heatmap: {heatmapEnabled ? 'On' : 'Off'}
                </button>
              ) : null}
              <button
                type="button"
                className="btn-outline report-map-expand-btn report-map-icon-btn"
                onClick={() => setShowFullscreenMap(true)}
                aria-label="Open full screen map"
                title="Open full screen map"
              >
                <svg
                  className="report-map-icon-svg"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M9 3H3v6M15 3h6v6M9 21H3v-6M21 21h-6v-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9 9 3 3M15 9 21 3M9 15 3 21M15 15 21 21"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            <MapCanvas
              selectedPosition={selectedPosition}
              safeMarkers={categoryFilteredMarkers}
              autoFitMarkers={inlineAutoFitMarkers}
              tileSource={tileSource}
              handleTileError={handleTileError}
              onPick={onPick}
              expandKey="inline"
              activeMarkerId={activeMarker?.id || null}
              onMarkerClick={handleMarkerSelect}
              routePath={routePath}
              userPosition={userPosition}
              freezeMarkerAutoFit={preserveViewOnRefresh}
              showHeatmap={heatmapEnabled}
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
            statusOptions={statusOptions}
            canUpdateStatus={canUpdateStatus && typeof onStatusChange === 'function' && statusOptions.length > 0}
            updatingStatusForId={updatingStatusForId}
            onStatusChange={onStatusChange}
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
              <div className="report-map-modal-controls">
                <div className="report-map-modal-filters">
                  {enableCategoryFilter ? (
                    <div className="report-map-filter-group">
                    <select
                      id="fullscreen-category-filter"
                      className="form-select report-map-filter-select"
                      value={categoryFilter}
                      onChange={(event) => setCategoryFilter(event.target.value)}
                      aria-label="Filter by report category"
                    >
                      <option value="all">All categories</option>
                      {categoryFilterOptions.map((item) => (
                        <option key={item.key} value={item.key}>{item.label}</option>
                      ))}
                    </select>
                    </div>
                  ) : null}
                  {enableFullscreenBarangayFilter ? (
                    <div className="report-map-filter-group">
                    <label htmlFor="fullscreen-barangay-filter" className="report-map-filter-label">Barangay</label>
                    <select
                      id="fullscreen-barangay-filter"
                      className="form-select report-map-filter-select"
                      value={fullscreenBarangayFilter}
                      onChange={(event) => setFullscreenBarangayFilter(event.target.value)}
                    >
                      <option value="all">All barangays</option>
                      {fullscreenBarangayOptions.map((barangay) => (
                        <option key={barangay} value={barangay}>{barangay}</option>
                      ))}
                    </select>
                    </div>
                  ) : null}
                </div>
                <div className="report-map-modal-actions">
                  {enableHeatmapToggle ? (
                    <button
                      type="button"
                      className="btn-outline report-map-expand-btn"
                      onClick={() => setHeatmapEnabled((prev) => !prev)}
                      aria-pressed={heatmapEnabled}
                    >
                      Heatmap: {heatmapEnabled ? 'On' : 'Off'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn-outline report-map-expand-btn"
                    onClick={() => setShowFullscreenMap(false)}
                    aria-label="Close full screen map"
                  >
                    X
                  </button>
                </div>
              </div>
            </div>

            <div className="report-map-modal-content">
              <div className="report-map-layout report-map-layout-modal">
                <div className="report-map-pane">
                  <MapCanvas
                    selectedPosition={selectedPosition}
                    safeMarkers={fullscreenFilteredMarkers}
                    autoFitMarkers={fullscreenAutoFitMarkers}
                    tileSource={tileSource}
                    handleTileError={handleTileError}
                    onPick={onPick}
                    expandKey="modal"
                    activeMarkerId={activeMarker?.id || null}
                    onMarkerClick={handleMarkerSelect}
                    routePath={routePath}
                    userPosition={userPosition}
                    freezeMarkerAutoFit={preserveViewOnRefresh}
                    showHeatmap={heatmapEnabled}
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
                    statusOptions={statusOptions}
                    canUpdateStatus={canUpdateStatus && typeof onStatusChange === 'function' && statusOptions.length > 0}
                    updatingStatusForId={updatingStatusForId}
                    onStatusChange={onStatusChange}
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
