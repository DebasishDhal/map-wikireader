// import logo from './logo.svg';
import './App.css';
import Map from './components/Map';
// import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet';


function App() {
  const handleMapClick = (lat, lng) => {
    console.log(`Map clicked at latitude: ${lat}, longitude: ${lng}`);
  }

  return (
    <div className="App">
      <Map onMapClick={handleMapClick}/>
    </div>
  );

}



export default App;
