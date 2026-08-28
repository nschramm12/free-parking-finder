import * as React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

interface ParkingSpot {
  id: string;
  lat: number;
  lng: number;
  type: string;
  name?: string;
  fee?: string;
  access?: string;
  capacity?: number;
}

interface Position {
  lat: number;
  lng: number;
}

function buildOverpassQuery(lat: number, lng: number, radius: number): string {
  return `[out:json][timeout:25];
(
  nwr["amenity"="parking"][fee~"^(no|free)$"](around:${radius},${lat},${lng});
  nwr["amenity"="parking_space"][fee~"^(no|free)$"](around:${radius},${lat},${lng});
  nwr["parking"="street"][fee~"^(no|free)$"](around:${radius},${lat},${lng});
  nwr["parking"="surface"]["access"="yes"][fee~"^(no|free)$"](around:${radius},${lat},${lng});
);
out center;`;
}

const OVERPASS_ENDPOINT = 'https://overpass.private.coffee/api/interpreter';
const RADIUS_METERS = 800;

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [position, setPosition] = useState<Position | null>(null);
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpot, setSelectedSpot] = useState<ParkingSpot | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [geolocState, setGeolocState] = useState<'prompt' | 'denied' | 'granted' | 'unavailable'>('prompt');
  const [count, setCount] = useState(0);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeolocState('unavailable');
      setError('Geolocation is not supported by your browser.');
      return;
    }
    setGeolocState('prompt');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeolocState('granted');
        setError(null);
      },
      () => {
        setGeolocState('denied');
        setError('Location access denied. Search for a city or address below.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  }, []);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [-98.5795, 39.8283],
      zoom: 3,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true as any }), 'bottom-right');
    map.on('load', () => map.resize());
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
  }, []);

  const fetchParkingSpots = useCallback(async (lat: number, lng: number) => {
    setLoading(true);
    setError(null);
    setSelectedSpot(null);
    clearMarkers();
    try {
      const query = buildOverpassQuery(lat, lng, RADIUS_METERS);
      const response = await fetch(OVERPASS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) throw new Error(`Overpass API returned ${response.status}`);
      const data = await response.json();
      const parsed: ParkingSpot[] = (data.elements || [])
        .filter((el: any) => el.center || (el.lat && el.lon))
        .map((el: any) => {
          const c = el.center || el;
          const tags = el.tags || {};
          return {
            id: `${el.type}/${el.id}`,
            lat: c.lat,
            lng: c.lon,
            type: el.type,
            name: tags.name || tags.operator || '',
            fee: tags.fee,
            access: tags.access,
            capacity: tags.capacity ? parseInt(tags.capacity, 10) : undefined,
          };
        });
      setSpots(parsed);
      setCount(parsed.length);
      parsed.forEach(spot => {
        const el = document.createElement('div');
        el.className = 'parking-marker';
        el.innerHTML = `<svg width="30" height="30" viewBox="0 0 30 30" fill="none"><circle cx="15" cy="15" r="13" fill="#10b981" stroke="white" stroke-width="3"/><circle cx="15" cy="15" r="13" fill="url(#g)" opacity="0.2"/><text x="15" y="19.5" text-anchor="middle" fill="white" font-size="13" font-family="sans-serif" font-weight="700">P</text></svg>`;
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([spot.lng, spot.lat])
          .addTo(mapRef.current!);
        el.addEventListener('click', () => setSelectedSpot(spot));
        markersRef.current.push(marker);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch parking data');
    } finally {
      setLoading(false);
    }
  }, [clearMarkers]);

  useEffect(() => {
    if (!position || !mapRef.current) return;
    mapRef.current.flyTo({ center: [position.lng, position.lat], zoom: 15, duration: 1500 });
    fetchParkingSpots(position.lat, position.lng);
  }, [position, fetchParkingSpots]);

  const handleSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=1`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      if (data.length === 0) {
        setError('Location not found. Try a different search.');
        setLoading(false);
        return;
      }
      setPosition({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
      setGeolocState('granted');
    } catch {
      setError('Failed to search location.');
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  const focusSpot = useCallback((spot: ParkingSpot) => {
    setSelectedSpot(spot);
    mapRef.current?.flyTo({ center: [spot.lng, spot.lat], zoom: 17, duration: 800 });
  }, []);

  function humanType(type: string): string {
    const map: Record<string, string> = { node: 'Parking Spot', way: 'Parking Lot', relation: 'Parking Area' };
    return map[type] || type;
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1 className="title">🅿️ Free Parking Finder</h1>
          <p className="subtitle">Powered by OpenStreetMap — tap a marker to see details</p>
        </div>
      </header>
      <div className="search-bar">
        <form onSubmit={handleSearch} className="search-form">
          <svg className="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" placeholder="Search city or address..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="search-input" />
          <button type="submit" className="search-btn" disabled={loading}>{loading ? 'Searching...' : 'Search'}</button>
          {geolocState !== 'granted' && (
            <button type="button" onClick={requestLocation} className="locate-btn" title="Use my location">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>
            </button>
          )}
        </form>
      </div>
      <div className="main">
        <div className="map-wrapper">
          <div ref={mapContainer} className="map" />
          {geolocState === 'prompt' && !position && (
            <div className="overlay">
              <div className="overlay-card">
                <h2>Find Free Parking</h2>
                <p>Allow location access to find free parking spots near you, or search for a city above.</p>
                <button onClick={requestLocation} className="btn-primary">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>
                  Use My Location
                </button>
              </div>
            </div>
          )}
          {loading && (
            <div className="loading-overlay">
              <div className="spinner" />
              <p>Finding free parking spots...</p>
            </div>
          )}
        </div>
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>Parking Spots</h2>
            {count > 0 && <span className="badge">{count} found</span>}
          </div>
          {error && (
            <div className="error-banner">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>{error}</span>
            </div>
          )}
          {selectedSpot && (
            <div className="spot-detail">
              <div className="spot-detail-header">
                <h3>{selectedSpot.name || 'Free Parking'}</h3>
                <button className="close-btn" onClick={() => setSelectedSpot(null)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div className="spot-detail-body">
                <div className="detail-row"><span>Type</span><span className="tag">{humanType(selectedSpot.type)}</span></div>
                {selectedSpot.capacity && <div className="detail-row"><span>Capacity</span><span>{selectedSpot.capacity} spots</span></div>}
                {selectedSpot.access && <div className="detail-row"><span>Access</span><span>{selectedSpot.access}</span></div>}
                {selectedSpot.fee && <div className="detail-row"><span>Fee</span><span className="tag tag-free">Free ✓</span></div>}
              </div>
            </div>
          )}
          <div className="spots-list">
            {spots.map(spot => (
              <div key={spot.id} className={`spot-card ${selectedSpot?.id === spot.id ? 'active' : ''}`} onClick={() => focusSpot(spot)}>
                <div className="spot-card-icon">
                  <svg width="22" height="22" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="12" fill="#10b981" stroke="white" strokeWidth={2.5}/><text x="14" y="18" text-anchor="middle" fill="white" fontSize="12" fontFamily="sans-serif" fontWeight="bold">P</text></svg>
                </div>
                <div className="spot-card-info">
                  <strong>{spot.name || 'Free Parking'}</strong>
                  <span className="spot-type">{humanType(spot.type)}{spot.capacity ? ` · ${spot.capacity} spots` : ''}</span>
                </div>
                <svg className="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            ))}
            {!loading && !error && geolocState === 'granted' && spots.length === 0 && (
              <div className="empty-state"><p>No free parking spots found nearby.</p><p className="empty-sub">Try a different area or zoom in closer.</p></div>
            )}
          </div>
          <div className="footer-note">
            <p>Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors. Free parking availability may not be guaranteed — always check local signage.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
