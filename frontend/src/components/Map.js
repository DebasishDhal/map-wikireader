import React, { useState, useEffect, useRef,
    useCallback
 } from 'react';
import { MapContainer, TileLayer, 
        useMapEvents,
        Marker, 
        Popup ,
        useMap,
        Polyline,
        Tooltip,
        Polygon,
        GeoJSON,
        ScaleControl
    } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { generateGeodesicPoints, calculatePolygonArea, getPolygonCentroid, formatArea, formatPerimeter } from '../utils/mapUtils';


delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const maxExplorationLimit = 50; // kilometers, the maximum amount user can select to explore.

const ClickHandler = ({ onClick }) => {
    useMapEvents({
      click(e) {
        const { lat, lng } = e.latlng;
        onClick(lat, lng);
      },
    });
    return null;
};

const rawUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8004';
const BACKEND_URL = rawUrl.replace(/\/$/, ''); 
// console.log(BACKEND_URL);

const ResizeHandler = ({ trigger }) => {
    const map = useMap();
    useEffect(() => {
        map.invalidateSize();
    }, [trigger, map]);
    return null;
};
const WikiMap = ( { onMapClick, searchQuery, contentType, setSearchQuery, setSubmittedQuery } ) => {
    const [baseLayer, setBaseLayer] = useState("base"); // "base" | "satellite"

    const [markerPosition, setMarkerPosition] = useState(null);
    const [wikiContent, setWikiContent] = useState(null);
    const [panelSize, setPanelSize] = useState('half');
    const [wikiWidth, setWikiWidth] = useState(20);
    const [iframeSrc, setIframeSrc] = useState(''); 
    const isDragging = useRef(false);
    const startX = useRef(0);
    const startWidth = useRef(0);
    const containerRef = useRef(null);
 
    const [geoPoints, setGeoPoints] = useState([]);
    const [geoDistance, setGeoDistance] = useState(null);

    const [geoSidebarOpen, setGeoSidebarOpen] = useState(false);
    const [geoToolMode, setGeoToolMode] = useState("menu"); // "menu" | "distance" | "area"
    const [geoUnit, setGeoUnit] = useState('km');

    const [isGeoMarkerDragging, setIsGeoMarkerDragging] = useState(false);

    const distanceCache = useRef({});

    const [areaPoints, setAreaPoints] = useState([]);
    const [polygonArea, setPolygonArea] = useState(null);
    const [areaUnit, setAreaUnit] = useState('sqm'); // 'sqm', 'sqkm', 'ha', 'acres', 'sqmi'
    
    const [numberFormat, setNumberFormat] = useState('normal'); // 'normal' | 'scientific'

    const [polygonPerimeter, setPolygonPerimeter] = useState(null);

    const [viewPanelOpen, setViewPanelOpen] = useState(true);
    
    const [countryBorders, setCountryBorders] = useState(null);

    const [explorationMode, setExplorationMode] = useState(false);
    const [explorationRadius, setExplorationRadius] = useState(10);
    const [explorationLimit, setExplorationLimit] = useState(10);
    const [explorationMarkers, setExplorationMarkers] = useState([]);
    const [explorationSidebarOpen, setExplorationSidebarOpen] = useState(false);
    const [shouldZoom, setShouldZoom] = useState(false);
    const [zoomDelaySeconds, setZoomDelaySeconds] = useState(3); // Default zoom delay in seconds

    // Using CenterMap component to handle centering (for summary/full apis) and for zooming (for wiki/nearby api)
    const CenterMap = ({ position, coordinates, shouldZoom, setShouldZoom, zoomDelaySeconds }) => {
        const map = useMap();
        useEffect(() => {
            if (position && Array.isArray(position) && position.length === 2) {
            map.setView(position, map.getZoom());
            }
        }, [map, position]);


        useEffect(() => {
            if (coordinates && Array.isArray(coordinates) && coordinates.length > 1  && shouldZoom) {
                const bounds = L.latLngBounds(coordinates);
                console.log("Delay:", zoomDelaySeconds);
                if (zoomDelaySeconds > 0) {
                    map.flyToBounds(bounds, {
                        padding: [50, 50],
                        maxZoom: 16,
                        duration: zoomDelaySeconds
                    });
                } else {
                    map.fitBounds(bounds, {
                        padding: [50, 50],
                        maxZoom: 16
                    });
                }
                setShouldZoom(false);
            }
        }, [coordinates, map, shouldZoom, setShouldZoom, zoomDelaySeconds]);

        return null;
    };


    const handleMouseDown = (e) => {
        isDragging.current = true;
        startX.current = e.clientX;
        startWidth.current = wikiWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    const handleMouseMove = (e) => {
        if (!isDragging.current || !containerRef.current) return;
        
        const containerWidth = containerRef.current.offsetWidth;
        const deltaX = e.clientX - startX.current;
        const newWidth = Math.max(20, Math.min(80, startWidth.current + (deltaX / containerWidth * 100)));
        
        setWikiWidth(newWidth);
    };

    const handleMouseUp = () => {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }

    useEffect(() => {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);


    const fetchWiki = useCallback(async (pageName) => {
        try{
            let endpoint;
            if (contentType === 'summary') {
                endpoint = `${BACKEND_URL}/wiki/search/summary/${pageName}`;
            }
            else if (contentType === 'full') {
                endpoint = `${BACKEND_URL}/wiki/search/full/${pageName}`;
            }

            else {
                console.log("Invalid content type:", contentType);
                setWikiContent(null);
                return;
            }

            const res = await fetch(endpoint);
            const data = await res.json();

            if (contentType === 'summary') {
                setWikiContent(data);
                if (data?.latitude && data?.longitude) {
                  setMarkerPosition([data.latitude, data.longitude]);
                }
              } else if (contentType === 'full') {
                setWikiContent({
                  title: data.title,
                  content: data.content
                });

                const htmlContent = `
                    <!DOCTYPE html>
                    <html>
                        <head>
                            <style>
                                body { font-family: Arial, sans-serif; padding: 20px; }
                                img { max-width: 100%; }
                            </style>
                            <base href="https://en.wikipedia.org">"
                            <!-- The upper line is added so that relative links in the Wikipedia content work correctly. -->
                        </head>
                        <body>
                            ${data.content}
                        </body>
                    </html>
                `;
                const blob = new Blob([htmlContent], { type: 'text/html' });
                const blobUrl = URL.createObjectURL(blob);
                setIframeSrc(blobUrl);

                if (data?.latitude && data?.longitude) {
                  setMarkerPosition([data.latitude, data.longitude]);
                }
              }
              else {
                console.log("Invalid content type:", contentType);
                setWikiContent(null);
              }
            } catch (error) {
              console.error("Error fetching Wikipedia content:", error);
            }
          }, [contentType]);

    useEffect(() => {
        if (searchQuery) {
            fetchWiki(searchQuery);
        }
    }, [searchQuery, fetchWiki]);

    const togglePanel = () => {
        setPanelSize(prev => {
            if (prev === 'half')  return 'half';
            if (prev === 'full')  return 'half';
            return 'half';
        });
        setWikiWidth(20);
    };

    const handleExplorationClick = useCallback(async (lat, lon) => {
        try{
            const res = await fetch(`${BACKEND_URL}/wiki/nearby`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lat: lat,
                    lon: lon,
                    radius: explorationRadius*1000,
                    limit: explorationLimit
                }),
            });
            
            if (res.ok) {
                const data = await res.json();
                const markers = data.pages.map(page => ({
                    position: [page.lat, page.lon],
                    title: page.title,
                    distance: page.dist
                }));
                // setExplorationMarkers(markers);
                // Now adding the main clicked point
                setExplorationMarkers([
                    {
                        position: [lat, lon],
                        title: 'Clicked Location',
                        distance: 0,
                        isClickedPoint: true
                    },
                    ...markers
                ]);
                setShouldZoom(true);
                console.log(`Found ${markers.length} nearby pages`); // Only backend results.
            } else {
                console.error('Failed to fetch nearby pages');
            }
        } catch (err) {
            console.error('Error fetching nearby pages:', err);
        }
        
    }, [explorationRadius, explorationLimit, setExplorationMarkers, setShouldZoom]);

    const handleDistanceClick = useCallback(async (lat, lon) => {
        const updatedPoints = [...geoPoints, { lat, lon }];
            if (updatedPoints.length > 2) {
              updatedPoints.shift(); // keep only two
            }
            setGeoPoints(updatedPoints);
          
            if (updatedPoints.length === 2) {
                console.log("Fetching distance");
              try {

                const res = await fetch(`${BACKEND_URL}/geodistance`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    lat1: updatedPoints[0].lat,
                    lon1: updatedPoints[0].lon,
                    lat2: updatedPoints[1].lat,
                    lon2: updatedPoints[1].lon,
                    unit: geoUnit,
                  }),
                });
                const data = await res.json();
                setGeoDistance(data.distance);
                setGeoSidebarOpen(true);
                console.log("Distance fetched:", data.distance);
              } catch (err) {
                console.error('Failed to fetch distance:', err);
                setGeoDistance(null);
              }
            }
    }, [geoPoints, geoUnit, setGeoPoints, setGeoDistance, setGeoSidebarOpen]);

    const handleAreaClick = useCallback((lat, lon) => {
        const updated = [...areaPoints, [lat, lon]];
        setAreaPoints(updated);
    }, [areaPoints, setAreaPoints]);

    const handleMapClick = useCallback(async (lat, lon) => {
        if (explorationMode) {
            await handleExplorationClick(lat, lon);
        } else if (geoToolMode === "distance") {
            await handleDistanceClick(lat, lon);
        } else if (geoToolMode === "area") {
            handleAreaClick(lat, lon);
        }
        else {
            console.log("Invalid tool mode:", geoToolMode);
        }

    }, [explorationMode, geoToolMode, handleExplorationClick, handleDistanceClick, handleAreaClick]);

    useEffect(() => {
        if (geoPoints.length === 2) {
            const cacheKey = `${geoPoints[0].lat},${geoPoints[0].lon}-${geoPoints[1].lat},${geoPoints[1].lon}-${geoUnit}`;
            if (distanceCache.current[cacheKey]) {
                setGeoDistance(distanceCache.current[cacheKey]);
                console.log("Using cached distance:", distanceCache.current[cacheKey].toFixed(3));
                return;
            }

            const fetchDistance = async () => {
                try{
                    const res = await fetch(`${BACKEND_URL}/geodistance`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            lat1: geoPoints[0].lat,
                            lon1: geoPoints[0].lon,
                            lat2: geoPoints[1].lat,
                            lon2: geoPoints[1].lon,
                            unit: geoUnit
                        }),
                });
                    const data = await res.json();
                    setGeoDistance(data.distance);
                    distanceCache.current[cacheKey] = data.distance; // Setting up the cache here, forgot it in first attempt.
                    console.log("Using normal distance method:", data.distance.toFixed(3));
                }
                catch (err) {
                    console.error('Failed to fetch distance:', err);
                    setGeoDistance(null);
                }
            };

            if (isGeoMarkerDragging){
                const timeoutId = setTimeout(() => {
                    fetchDistance();
                }, 100); // 100ms timeout, before every backend call during dragging
                return () => clearTimeout(timeoutId);
            }

            fetchDistance();
        }
      }, [geoPoints, geoUnit, isGeoMarkerDragging]);

    useEffect(() => {
        if (geoToolMode === "area" && areaPoints.length >= 3) {
            // Just ensuring that the polygon is closed (first == last)
            const closed = [...areaPoints, areaPoints[0]];
            const {area, perimeter} = calculatePolygonArea(closed); // This took me a while to figure out, it should be just (lat, lon), not (lon, lat)
            setPolygonArea(area);
            setPolygonPerimeter(perimeter);

        } else {
            setPolygonArea(null);
            setPolygonPerimeter(null);
        }
    }, [geoToolMode, areaPoints]);

    useEffect(() => {
        if (!countryBorders) {
            fetch('/data/countryBordersCondensed.json')
                .then(res => res.json())
                .then(data => setCountryBorders(data))
                .catch(err => console.error("Failed to load country borders:", err));
        }
    }, [countryBorders]);

    const wrapCount = 3;

    const equatorLines = [];
    for (let i = -wrapCount; i <= wrapCount; i++) {
        const offset = i * 360;
        equatorLines.push([
            [0, -180 + offset],
            [0, 180 + offset],
        ]);
    }
    const cancerLat = 23.4366;
    const capricornLat = -23.4366;
    const generateWrappedLine = (latitude) => {
        const lines = [];
        for (let i = -wrapCount; i <= wrapCount; i++) {
          const offset = i * 360;
          lines.push([
            [latitude, -180 + offset],
            [latitude, 180 + offset],
          ]);
        }
        return lines;
      };
      
    const tropicOfCancerLines = generateWrappedLine(cancerLat);
    const tropicOfCapricornLines = generateWrappedLine(capricornLat);

    const generateLongitudeLines = (interval = 30, wraps = 1) => {
        const lines = [];
      
        for (let lon = -180; lon <= 180; lon += interval) {
          for (let w = -wraps; w <= wraps; w++) {
            const wrappedLon = lon + (360 * w);
            lines.push([
              [-90, wrappedLon],
              [90, wrappedLon]
            ]);
          }
        }
      
        return lines;
      };



    return (
        <div ref={containerRef} style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden' }}>
            {panelSize !== 'closed' && (
                <>
                    <div style={{
                        width: `${wikiWidth}%`,
                        height: '100%',
                        overflow: 'auto',
                        padding: '20px',
                        backgroundColor: 'white',
                        boxShadow: '2px 0 5px rgba(0,0,0,0.1)',
                        zIndex: 1000,
                        flexShrink: 0
                    }}>
                        <div style={{ marginBottom: '20px' }}>
                            <h2 style={{ margin: 2}}>{wikiContent?.title || 'Search for a location'}</h2>
                            {markerPosition && (
                                <button
                                    onClick={() => {
                                        setMarkerPosition(null);
                                        setWikiContent(null);
                                        setIframeSrc('');                                        
                                        setSearchQuery('');
                                        setSubmittedQuery('');
                                    }}
                                    style={{
                                        padding: '3px 8px',
                                        background: '#e53935',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: 4,
                                        cursor: 'pointer',
                                        fontWeight: 500,
                                    }}
                                >
                                    Remove Marker
                                </button>
                            )}
                        </div>
                        {wikiContent ? (
                        <div>
                            {contentType === 'full' ? (
                                <iframe
                                    src={iframeSrc}
                                    style={{
                                        width: '100%',
                                        height: 'calc(100vh - 100px)',
                                        border: 'none'
                                    }}
                                    title="Wikipedia Page"
                                />
                            ) : (
                                <p>{wikiContent.content}</p>
                            )}
                        </div>
                    ) : (
                        <p>Search for a location to see Wikipedia content</p>
                    )}
                    </div>
                    <div
                        onMouseDown={handleMouseDown}
                        style={{
                            width: '8px',
                            height: '100%',
                            backgroundColor: '#f0f0f0',
                            cursor: 'col-resize',
                            position: 'relative',
                            zIndex: 1001,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                        }}
                    >
                        <div style={{
                            width: '2px',
                            height: '40px',
                            backgroundColor: '#ccc',
                            borderRadius: '1px'
                        }} />
                    </div>
                </>
            )}
            <div style={{ 
                flex: 1,
                height: '100%',
                position: 'relative',
                minWidth: 0,
                overflow: 'hidden'
            }}>
                {/* View radio group with minimize/restore */}
                {viewPanelOpen ? (
                    <div style={{
                        position: 'absolute',
                        top: 12,
                        left: 48, // moved right
                        zIndex: 1200,
                        background: 'white',
                        borderRadius: 8,
                        boxShadow: '0 2px 8px rgba(12, 12, 12, 0.08)',
                        padding: '6px 9px 6px 9px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0,
                        minWidth: 100,
                        transition: 'all 0.3s ease-in-out',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontWeight: 600, fontSize: 16, color: '#333' }}>Map View</span>
                            <button
                                onClick={() => setViewPanelOpen(false)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    top: 12,
                                    left: 48, 
                                    fontSize: 18,
                                    cursor: 'pointer',
                                    color: '#888',
                                    marginLeft: 12,
                                    lineHeight: 1,
                                }}
                                title="Minimize"
                            >–</button>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                                type="radio"
                                name="view"
                                value="base"
                                checked={baseLayer === "base"}
                                onChange={() => setBaseLayer("base")}
                            />
                            Base
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                                type="radio"
                                name="view"
                                value="satellite"
                                checked={baseLayer === "satellite"}
                                onChange={() => setBaseLayer("satellite")}
                            />
                            Satellite
                        </label>
                    </div>
                ) : (
                    <button
                        onClick={() => setViewPanelOpen(true)}
                        style={{
                            position: 'absolute',
                            top: 16,
                            left: 50,
                            zIndex: 1200,
                            background: 'white',
                            borderRadius: 8,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                            padding: '8px 14px',
                            border: '1px solid #eee',
                            cursor: 'pointer',
                            fontWeight: 600,
                        }}
                        title="Show View Options"
                    >
                        View +
                    </button>
                )}
                <MapContainer
                    center={markerPosition || [0, 0]} // Default center if no marker position
                    zoom={2.5} //Originally 2
                    style={{ height: '100%', width: '100%' }}
                    minZoom={2}
                    // maxZoom={5}
                    maxBounds={[
                        [-90, -180],
                        [90, 180]
                    ]}
                    maxBoundsViscosity={1.0} // This completely prevents panning outside the horizonta/vertical bounds of the map. Avoids showing ugly section of the maps.
                >

                    <ScaleControl position="bottomright" imperial={true} />

                    <ResizeHandler trigger={wikiWidth} />
                    <CenterMap 
                        position={markerPosition}
                        coordinates={explorationMarkers.map((marker) => marker.position)}
                        shouldZoom={shouldZoom}
                        setShouldZoom={setShouldZoom}
                        zoomDelaySeconds={zoomDelaySeconds}
                    />
                    {baseLayer === "satellite" && (
                    <>
                        <TileLayer
                            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                            attribution='&copy; <a href="https://www.esri.com/">Esri</a> & contributors'
                        />
                        <TileLayer
                            url="https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png"
                            attribution='&copy; CartoDB'
                        />
                        {countryBorders && (
                            <GeoJSON
                                data={countryBorders}
                                style={{
                                    color: '#ffff99',
                                    weight: 1.5,
                                    opacity: 0.8,
                                    fillOpacity: 0.1,
                                }}
                            />
                        )}
                    </>
                    )}

                    {baseLayer === "base" && (
                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    />
                    )}
                    
                    {/* Tropics and Equator Lines */}
                    <>
                    {tropicOfCancerLines.map((line, idx) => (
                        <Polyline
                        key={`cancer-${idx}`}
                        positions={line}
                        pathOptions={{
                            color: 'gray',
                            weight: 1,
                            dashArray: '4, 4',
                            interactive: false,
                        }}
                        />
                    ))}

                    {tropicOfCapricornLines.map((line, idx) => (
                        <Polyline
                        key={`capricorn-${idx}`}
                        positions={line}
                        pathOptions={{
                            color: 'gray',
                            weight: 1,
                            dashArray: '4, 4',
                            interactive: false,
                        }}
                        />
                    ))}

                    {generateLongitudeLines(30, 1).map((line, index) => (
                        <Polyline
                            key={`lon-line-${index}`}
                            positions={line}
                            pathOptions={{
                                color: '#aaa',
                                dashArray: '4, 4',
                                weight: 1,
                                interactive: false,
                            }}
                        />
                        ))}
                    </>

                    {/* Equator Lines */}
                    {equatorLines.map((line, idx) => (
                    <Polyline
                        key={`equator-${idx}`}
                        positions={line}
                        pathOptions={{
                            color: 'gray',
                            weight: 1.5,
                            dashArray: '6, 6',
                            interactive: false,
                        }}
                    />

                    
                    ))}

                    <ClickHandler onClick={handleMapClick} />
                    {markerPosition && (
                        <Marker position={markerPosition}>
                            {contentType === 'summary' && (
                            <Popup minWidth={250}>
                                {wikiContent ? (
                                    <>
                                        <strong>{wikiContent.title}</strong><br />
                                        <p style={{ fontSize: '12px' }}>{wikiContent.content}</p>
                                    </>
                                ) : (
                                    "Search for a location to see information"
                                )}
                            </Popup>
                            )}
                        </Marker>
                    )}

                    {/* Exploration Mode Markers */}
                    {explorationMode && explorationMarkers.map((marker, index) => (
                        <Marker 
                            key={`exploration-${index}`}
                            position={marker.position}
                            icon={marker.isClickedPoint ? new L.Icon({
                                iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
                                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
                                iconSize: [25, 41],
                                iconAnchor: [12, 41],
                                popupAnchor: [1, -34],
                                shadowSize: [41, 41]
                            }) : new L.Icon({
                                iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
                                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
                                iconSize: [25, 41],
                                iconAnchor: [12, 41],
                                popupAnchor: [1, -34],
                                shadowSize: [41, 41]
                            })}
                        >
                            <Popup>
                                <div>
                                    <strong>{marker.title}</strong><br />
                                    {!marker.isClickedPoint && (
                                        <small>Distance: {marker.distance.toFixed(1)}m</small>
                                    )}
                                    {marker.isClickedPoint && (
                                        <small>Pos: {marker.position[0].toFixed(4)}, {marker.position[1].toFixed(4)}</small>
                                    )}
                                </div>
                            </Popup>
                        </Marker>
                    ))}

                    {/* Only show geodistance markers/polyline if sidebar is open */}
                    {geoSidebarOpen && geoToolMode === "distance" && geoPoints.map((pt, index) => (
                        <Marker key={`geo-${index}`}
                            position={[pt.lat, pt.lon]}
                            draggable={true}
                            eventHandlers={{
                                dragstart: () => {
                                    setIsGeoMarkerDragging(true);
                                },
                                drag: (e) => {
                                    const { lat, lng } = e.target.getLatLng();
                                    const updated = [...geoPoints];
                                    updated[index] = { lat, lon: lng };
                                    setGeoPoints(updated); // The distance function will be continioust triggered throughout the dragging journey
                                }                                ,
                                dragend: (e) => {
                                    const { lat, lng } = e.target.getLatLng();
                                    const updated = [...geoPoints];
                                    updated[index] = { lat, lon: lng };
                                    setGeoPoints(updated); // Triggering the distance fetch via useEffect
                                    setIsGeoMarkerDragging(false);
                                    }
                            }}
                        >
                            <Popup>
                                Point {index + 1}: {pt.lat.toFixed(4)}, {pt.lon.toFixed(4)}
                            </Popup>
                        </Marker>
                    ))}

                    {/* Polyline if 2 points are selected and sidebar is open, simple enough */}
                    {geoSidebarOpen && geoToolMode === "distance" && geoPoints.length === 2 && (
                    <Polyline 
                        key={geoPoints.map(pt => `${pt.lat},${pt.lon}`).join('-')}
                        positions={generateGeodesicPoints(
                            geoPoints[0].lat, geoPoints[0].lon,
                            geoPoints[1].lat, geoPoints[1].lon
                        )}
                        pathOptions={{ color: '#1976d2', weight: 4 }}
                    >
                        {geoDistance !== null && (
                        <Tooltip
                            direction="center"
                            permanent
                            offset={[0, 0]}
                            opacity={1}
                            className="distance-tooltip"
                        >
                            <span style={{
                                color: '#1976d2',
                                fontWeight: 600,
                                fontSize: '15px',
                                background: 'none',
                                border: 'none',
                                boxShadow: 'none',
                                padding: 0
                            }}>
                                {geoDistance !== null
                                    ? (numberFormat === 'scientific'
                                        ? geoDistance.toExponential(2)
                                        : geoDistance.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })
                                    ) + ' ' + geoUnit
                                    : ''}
                            </span>
                        </Tooltip>
                        )}
                    </Polyline>
                    )}

                    {/* Area tools */}
                    {geoSidebarOpen && geoToolMode === "area" && areaPoints.length >= 2 && (
                        <Polyline
                            positions={areaPoints}
                            pathOptions={{ color: '#1976d2', weight: 3, dashArray: '4 6' }}
                        />
                    )}
                    {geoSidebarOpen && geoToolMode === "area" && areaPoints.length >= 3 && (
                        <>
                            <Polygon
                                positions={areaPoints}
                                pathOptions={{ color: '#1976d2', fillColor: '#1976d2', fillOpacity: 0.2 }}
                            />
                            {/* Area label at centroid */}
                            <Marker
                                position={getPolygonCentroid(areaPoints)}
                                interactive={false}
                                icon={L.divIcon({
                                    className: 'area-label',
                                    html: polygonArea !== null
                                        ? `<div style="background:rgba(255,255,255,0.8);padding:2px 6px;border-radius:4px;color:#1976d2;font-weight:600;">${formatArea(polygonArea, areaUnit, numberFormat)}</div>`
                                        : '',
                                    iconSize: [100, 24],
                                    iconAnchor: [50, 12]
                                })}
                            />
                        </>
                    )}
                    {geoSidebarOpen && geoToolMode === "area" && areaPoints.map((pt, idx) => (
                        <Marker
                            key={`area-${idx}`}
                            position={[pt[0], pt[1]]}
                            draggable={true}
                            eventHandlers={{
                                dragstart: () => {
                                    setIsGeoMarkerDragging(true);
                                },
                                dragend: (e) => {
                                    const { lat, lng } = e.target.getLatLng();
                                    const updated = [...areaPoints];
                                    updated[idx] = [lat, lng];
                                    setAreaPoints(updated);
                                    setIsGeoMarkerDragging(false);
                                }
                            }}
                        >
                            <Popup>
                                Point {idx + 1}: {pt[0].toFixed(4)}, {pt[1].toFixed(4)}
                            </Popup>
                        </Marker>
                    ))}

                </MapContainer>

                {/* Geo Tools Button */}
                {!geoSidebarOpen && (
                    <button
                        onClick={() => setGeoSidebarOpen(true)}
                        style={{
                            position: 'absolute',
                            top: 12,
                            right: 12,
                            zIndex: 1000,
                            padding: '6px 12px',
                            backgroundColor: '#1976d2',
                            color: 'white',
                            border: 'none',
                            borderRadius: 4,
                            cursor: 'pointer'
                        }}
                    >
                        Geo Tools
                    </button>
                )}

                {/* Exploration Mode Button */}
                {!explorationSidebarOpen && !geoSidebarOpen && (
                    <button
                        onClick={() => setExplorationSidebarOpen(true)}
                        style={{
                            position: 'absolute',
                            top: 50, // Position below Geo Tools button
                            right: 12,
                            zIndex: 1000,
                            padding: '6px 12px',
                            backgroundColor: '#4caf50',
                            color: 'white',
                            border: 'none',
                            borderRadius: 4,
                            cursor: 'pointer'
                        }}
                    >
                        Exploration
                    </button>
                )}

                {/* Exploration Mode Button - when Geo Tools sidebar is open */}
                {!explorationSidebarOpen && geoSidebarOpen && (
                    <button
                        onClick={() => setExplorationSidebarOpen(true)}
                        style={{
                            position: 'fixed',
                            top: 320, // Position below Geo Tools sidebar
                            right: 24,
                            zIndex: 2000,
                            padding: '6px 12px',
                            backgroundColor: '#4caf50',
                            color: 'white',
                            border: 'none',
                            borderRadius: 4,
                            cursor: 'pointer'
                        }}
                    >
                        Exploration
                    </button>
                )}

                {/* Exploration Sidebar */}
                {explorationSidebarOpen && (
                    <div style={{
                        position: 'fixed',
                        top: geoSidebarOpen ? 320 : 24, // Position below Geo Tools sidebar if open
                        right: 24,
                        width: 280,
                        background: 'white',
                        borderRadius: 10,
                        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
                        zIndex: 2000,
                        padding: 20,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 16,
                        border: '1px solid #eee'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <strong>Exploration Mode</strong>
                            <button
                                onClick={() => {
                                    setExplorationSidebarOpen(false);
                                    // setExplorationMode(false); // even with exp. sidebar closed, you can do exploration normally.
                                    // setExplorationMarkers([]);
                                    setShouldZoom(false); // If this line is removed, it map automatically zooms after re-opening/closing the exp. sidebar
                                }}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    fontSize: 18,
                                    cursor: 'pointer',
                                    color: '#888'
                                }}
                                title="Close"
                            >×</button>
                        </div>

                        <div>
                            <label style={{ fontWeight: 500, marginBottom: 8, display: 'block' }}>
                                Search Radius (km):
                            </label>
                            <input
                                type="range"
                                min="1"
                                max={maxExplorationLimit}
                                value={explorationRadius}
                                onChange={(e) => setExplorationRadius(parseInt(e.target.value))}
                                style={{ width: '100%' }}
                            />
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '8px', 
                                marginTop: 4,
                                justifyContent: 'center'
                            }}>
                                <input
                                    type="number"
                                    min="1"
                                    max={maxExplorationLimit}
                                    value={explorationRadius}
                                    onChange={(e) => {
                                        const value = parseInt(e.target.value);
                                        if (value >= 1 && value <= maxExplorationLimit) {
                                            setExplorationRadius(value);
                                        }
                                    }}
                                    style={{
                                        width: '80px',
                                        padding: '4px 8px',
                                        border: '1px solid #ccc',
                                        borderRadius: '4px',
                                        textAlign: 'center'
                                    }}
                                />
                                <span>km</span>
                            </div>
                        </div>

                        <div>
                            <label style={{ fontWeight: 500, marginBottom: 8, display: 'block' }}>
                                Number of Results:
                            </label>
                            <input
                                type="range"
                                min="1"
                                max="50"
                                step="1"
                                value={explorationLimit}
                                onChange={(e) => setExplorationLimit(parseInt(e.target.value))}
                                style={{ width: '100%' }}
                            />
                            <div style={{ textAlign: 'center', marginTop: 4 }}>
                                {explorationLimit} results
                            </div>
                        </div>


                        <div>
                            <label style={{ fontWeight: 500, marginBottom: 8, display: 'block' }}>
                                Zoom Delay (seconds):
                            </label>
                            <input
                                type="range"
                                min="0"
                                max="5"
                                step="1"
                                value={zoomDelaySeconds}
                                onChange={(e) => setZoomDelaySeconds(parseInt(e.target.value))}
                                style={{ width: '100%' }}
                            />
                            <div style={{ textAlign: 'center', marginTop: 4 }}>
                                {zoomDelaySeconds} sec. zoom duration
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                                type="checkbox"
                                id="explorationMode"
                                checked={explorationMode}
                                onChange={(e) => setExplorationMode(e.target.checked)}
                            />
                            <label htmlFor="explorationMode" style={{ fontWeight: 500 }}>
                                Enable Exploration Mode
                            </label>
                        </div>

                        {explorationMode && (
                            <div style={{ 
                                padding: '8px 12px', 
                                backgroundColor: '#e8f5e8', 
                                borderRadius: 4,
                                fontSize: '14px',
                                color: '#2e7d32'
                            }}>
                                ✓ Click anywhere on the map to find nearby Wikipedia pages
                            </div>
                        )}

                        {explorationMarkers.length > 0 && (
                            <div style={{ 
                                padding: '8px 12px', 
                                backgroundColor: '#e3f2fd', 
                                borderRadius: 4,
                                fontSize: '14px',
                                color: '#1976d2'
                            }}>
                                Found <span style={{ fontWeight: 'bold' }}>{explorationMarkers.length-1}</span> nearby pages
                            </div>
                        )}

                        <button
                            onClick={() => {
                                setExplorationMarkers([]);
                            }}
                            style={{
                                padding: '6px 0',
                                borderRadius: 4,
                                border: '1px solid #f44336',
                                background: '#f44336',
                                color: 'white',
                                fontWeight: 500,
                                cursor: 'pointer'
                            }}
                        >
                            Clear Markers
                        </button>
                    </div>
                )}

                {/* Geo Sidebar - Keep as is */}
                {geoSidebarOpen && (
                    <div style={{
                        position: 'fixed',
                        top: 24,
                        right: 24,
                        width: 280,
                        background: 'white',
                        borderRadius: 10,
                        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
                        zIndex: 2000,
                        padding: 20,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 16,
                        border: '1px solid #eee'
                    }}>
                        {geoToolMode === "menu" && (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <strong>Geo Tools</strong>
                                    <button
                                        onClick={() => {
                                            setGeoSidebarOpen(false);
                                            setGeoPoints([]);
                                            setGeoDistance(null);
                                            setGeoToolMode("menu");
                                        }}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            fontSize: 18,
                                            cursor: 'pointer',
                                            color: '#888'
                                        }}
                                        title="Close"
                                    >×</button>
                                </div>
                                <button
                                    style={{
                                        marginTop: 16,
                                        padding: '10px 0',
                                        borderRadius: 4,
                                        border: '1px solid #1976d2',
                                        background: '#1976d2',
                                        color: 'white',
                                        fontWeight: 500,
                                        cursor: 'pointer'
                                    }}
                                    onClick={() => setGeoToolMode("distance")}
                                >
                                    Measure distance
                                </button>
                                <button
                                    style={{
                                        marginTop: 16,
                                        padding: '10px 0',
                                        borderRadius: 4,
                                        border: '1px solid #1976d2',
                                        background: '#1976d2',
                                        color: 'white',
                                        fontWeight: 500,
                                        cursor: 'pointer'
                                    }}
                                    onClick={() => setGeoToolMode("area")}
                                >
                                    Measure area
                                </button>
                                {/* Add more tool buttons here in the future */}
                            </>
                        )}

                        {geoToolMode === "distance" && (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <strong>Geodistance</strong>
                                    <button
                                        onClick={() => {
                                            setGeoToolMode("menu");
                                            setGeoPoints([]);
                                            setGeoDistance(null);
                                        }}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            fontSize: 18,
                                            cursor: 'pointer',
                                            color: '#888'
                                        }}
                                        title="Back"
                                    >←</button>
                                </div>
                                <div>
                                    <label style={{ fontWeight: 500, marginRight: 8 }}>Unit:</label>
                                    <select
                                        value={geoUnit}
                                        onChange={e => setGeoUnit(e.target.value)}
                                        style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}
                                    >
                                        <option value="km">Kilometers</option>
                                        <option value="mi">Miles</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ fontWeight: 500, marginRight: 8 }}>Number format:</label>
                                    <select
                                        value={numberFormat}
                                        onChange={e => setNumberFormat(e.target.value)}
                                        style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}
                                    >
                                        <option value="normal">Normal</option>
                                        <option value="scientific">Scientific</option>
                                    </select>
                                </div>
                                {geoDistance !== null && (
                                    <div style={{ fontSize: 20, fontWeight: 600, color: '#1976d2' }}>
                                        {numberFormat === 'scientific'
                                            ? geoDistance.toExponential(2)
                                            : geoDistance.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })
                                        } {geoUnit}
                                    </div>
                                )}
                                <button
                                    onClick={() => {
                                        setGeoToolMode("menu");
                                        setGeoPoints([]);
                                        setGeoDistance(null);
                                    }}
                                    style={{
                                        marginTop: 8,
                                        padding: '6px 0',
                                        borderRadius: 4,
                                        border: '1px solid #1976d2',
                                        background: '#1976d2',
                                        color: 'white',
                                        fontWeight: 500,
                                        cursor: 'pointer'
                                    }}
                                >
                                    Clear & Back
                                </button>
                            </>
                        )}

                        {geoToolMode === "area" && (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <strong>Area</strong>
                                    <button
                                        onClick={() => {
                                            setGeoToolMode("menu");
                                            setAreaPoints([]);
                                            setPolygonArea(null);
                                            setPolygonPerimeter(null);
                                        }}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            fontSize: 18,
                                            cursor: 'pointer',
                                            color: '#888'
                                        }}
                                        title="Back"
                                    >←</button>
                                </div>
                                {polygonArea !== null && (
                                    <div style={{ fontSize: 20, fontWeight: 600, color: '#1976d2' }}>
                                        {formatArea(polygonArea, areaUnit, numberFormat)}
                                    </div>
                                )}
                                {polygonPerimeter !== null && (
                                    <div style={{ fontSize: 16, color: '#555' }}>
                                        Perimeter: {formatPerimeter(polygonPerimeter, areaUnit, numberFormat)}
                                    </div>
                                )}
                                <button
                                    onClick={() => {
                                        setGeoToolMode("menu");
                                        setAreaPoints([]);
                                        setPolygonArea(null);
                                        setPolygonPerimeter(null);
                                    }}
                                    style={{
                                        marginTop: 8,
                                        padding: '6px 0',
                                        borderRadius: 4,
                                        border: '1px solid #1976d2',
                                        background: '#1976d2',
                                        color: 'white',
                                        fontWeight: 500,
                                        cursor: 'pointer'
                                    }}
                                >
                                    Clear & Back
                                </button>
                                <div>
                                    <label style={{ fontWeight: 500, marginRight: 8 }}>Unit:</label>
                                    <select
                                        value={areaUnit}
                                        onChange={e => setAreaUnit(e.target.value)}
                                        style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}
                                    >
                                        <option value="m2">m²</option>
                                        <option value="km2">km²</option>
                                        <option value="ha">ha</option>
                                        <option value="mi2">mi²</option>
                                        <option value="acres">acres</option>
                                        <option value="sqft">ft²</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ fontWeight: 500, marginRight: 8 }}>Number format:</label>
                                    <select
                                        value={numberFormat}
                                        onChange={e => setNumberFormat(e.target.value)}
                                        style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}
                                    >
                                        <option value="normal">Normal</option>
                                        <option value="scientific">Scientific</option>
                                    </select>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {panelSize === 'closed' && (
                    <button 
                        onClick={togglePanel}
                        style={{
                            position: 'absolute',
                            top: '10px',
                            left: '10px',
                            zIndex: 1000,
                            padding: '5px 10px',
                            backgroundColor: 'white',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        Show Wikipedia
                    </button>
                )}
            </div>
        </div>
    );
};


export default WikiMap;