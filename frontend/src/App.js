// import logo from './logo.svg';
import './App.css';
import Map from './components/Map';
import React, { useState, 
  // useEffect,
  //  useCallback
   } from 'react';
// import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet';


function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');

  const handleMapClick = (lat, lng) => {
    console.log(`Map clicked at latitude: ${lat}, longitude: ${lng}`);
  };

  const handleSearch = (e) => {
    e.preventDefault(); 
    setSubmittedQuery(searchQuery);
    console.log(`Search query: ${searchQuery}`);
  };

  return (
    <div className="App">
      <div className="search-container">
        <form onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="Search for a location"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button type="submit">Search</button>
        </form>
      </div>
      <Map onMapClick={handleMapClick} searchQuery={submittedQuery} />
    </div>
  );
}



export default App;
