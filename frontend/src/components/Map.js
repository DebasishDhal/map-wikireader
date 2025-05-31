import React, { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, 
        useMapEvents,
        Marker, 
        Popup ,
        // useMap
    } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';


delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const ClickHandler = ({ onMapClick }) => {
    useMapEvents({
      click(e) {
        const { lat, lng } = e.latlng;
        onMapClick(lat, lng);
      },
    });
    return null;
  };



const Map = ( { onMapClick } ) => {
    const [wikiContent, setWikiContent] = useState(null);
    const fetchWiki = async (pageName) => {
        const res = await fetch(`http://localhost:8004/wiki/${pageName}`);
        const data = await res.json();
        setWikiContent(data);
      };
    const markerPosition = [21.2514, 81.6296];

    return (
        <MapContainer
            center={[0, 0]}
            zoom={2}
            style={{ height: '100vh', width: '100%' }}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            
            <ClickHandler onMapClick={onMapClick}/>
            <Marker position={markerPosition} eventHandlers={{
        click: () => fetchWiki("Raipur"),
      }}>
        <Popup minWidth={250}>
          {wikiContent ? (
            <>
              <strong>{wikiContent.title}</strong><br />
              <p style={{ fontSize: '12px' }}>{wikiContent.content}</p>
            </>
          ) : (
            "Click marker to load Wikipedia content"
          )}
        </Popup>
      </Marker>

            {/* Example marker */}
        </MapContainer>
    );
};

export default Map;