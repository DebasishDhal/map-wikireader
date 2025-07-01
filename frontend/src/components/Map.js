import React, { useState, useEffect, useRef,
    useCallback
 } from 'react';
import { MapContainer, TileLayer, 
        useMapEvents,
        Marker, 
        Popup ,
        useMap,
        Polyline,
        Tooltip
    } from 'react-leaflet';
import L from 'leaflet';

import 'leaflet/dist/leaflet.css';


delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const ClickHandler = ({ onClick }) => {
    useMapEvents({
      click(e) {
        const { lat, lng } = e.latlng;
        onClick(lat, lng);
      },
    });
    return null;
  };

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8004';
console.log(BACKEND_URL);

const ResizeHandler = ({ trigger }) => {
    const map = useMap();
    useEffect(() => {
        map.invalidateSize();
    }, [trigger, map]);
    return null;
};
const Map = ( { onMapClick, searchQuery, contentType } ) => {
    const [markerPosition, setMarkerPosition] = useState([0,0]);
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
                endpoint = `${BACKEND_URL}/wiki/${pageName}`;
            }
            else if (contentType === 'full') {
                endpoint = `${BACKEND_URL}/wiki/search/${pageName}`;
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
                if (data && data.latitude && data.longitude) {
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
                // const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
                // setIframeSrc(dataUrl);;
                if (data && data.latitude && data.longitude) {
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
    // const markerPosition = [21.2514, 81.6296];
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

    const handleGeoClick = useCallback(async (lat, lon) => {
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
                unit: 'km',
              }),
            });
            const data = await res.json();
            setGeoDistance(data.distance);
          } catch (err) {
            console.error('Failed to fetch distance:', err);
            setGeoDistance(null);
          }
        }
      }, [geoPoints]);

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
                            <h2>{wikiContent?.title || 'Search for a location'}</h2>
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
                <MapContainer
                    center={markerPosition}
                    zoom={2}
                    style={{ height: '100%', width: '100%' }}
                >
                    <ResizeHandler trigger={wikiWidth} />
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <ClickHandler onClick={handleGeoClick} />
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

                    {geoPoints.map((pt, index) => (
                        <Marker key={`geo-${index}`} position={[pt.lat, pt.lon]}>
                            <Popup>
                                Point {index + 1}: {pt.lat.toFixed(4)}, {pt.lon.toFixed(4)}
                            </Popup>
                    </Marker>
                    ))}

                    {/* Polyline if 2 points are selected */}
                    {geoPoints.length === 2 && (
                    <Polyline
                        key={geoPoints.map(pt => `${pt.lat},${pt.lon}`).join('-')}
                        positions={[
                            [geoPoints[0].lat, geoPoints[0].lon],
                            [geoPoints[1].lat, geoPoints[1].lon]
                        ]}
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
                                {geoDistance.toFixed(2)} km
                            </span>
                        </Tooltip>
                        )}
                    </Polyline>
                    )}

                </MapContainer>
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

export default Map;