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
  const [contentType, setContentType] = useState('summary'); // 'summary' or 'full'

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
          <select 
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
            style={{ margin: '0 10px' }}
          >
            <option value="summary">Summary</option>
            <option value="full">Full Content</option>
          </select>
          <button type="submit">Search</button>
        </form>
      </div>
      <Map 
        onMapClick={handleMapClick} 
        searchQuery={submittedQuery}
        contentType={contentType}
        setSearchQuery={setSearchQuery}
        setSubmittedQuery={setSubmittedQuery}
      />
    </div>
  );
}



export default App;
