
// Haversine-based geodesic interpolator
function generateGeodesicPoints(lat1, lon1, lat2, lon2, numPoints = 512) {
    /**
     * Generates a series of points along the geodesic path between two geographic coordinates, using Haversine function.
        * @returns {Array} An array of points, each represented as [latitude, longitude].
    */
    const toRad = deg => deg * Math.PI / 180;
    const toDeg = rad => rad * 180 / Math.PI;

    const φ1 = toRad(lat1);
    const λ1 = toRad(lon1);
    const φ2 = toRad(lat2);
    const λ2 = toRad(lon2);

    const Δ = 2 * Math.asin(
        Math.sqrt(
            Math.sin((φ2 - φ1) / 2) ** 2 +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin((λ2 - λ1) / 2) ** 2
        )
    );

    if (Δ === 0) return [[lat1, lon1]];

    const sinΔ = Math.sin(Δ);

    const points = [];

    for (let i = 0; i <= numPoints; i++) {
        const f = i / numPoints;
        const A = Math.sin((1 - f) * Δ) / sinΔ;
        const B = Math.sin(f * Δ) / sinΔ;

        const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
        const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
        const z = A * Math.sin(φ1) + B * Math.sin(φ2);

        const φi = Math.atan2(z, Math.sqrt(x * x + y * y));
        const λi = Math.atan2(y, x);

        points.push([toDeg(φi), toDeg(λi)]);
    }

    return points;
}



 /**
 * Calculate the area enclosed by coordinates using simplified Karney method
 * @param {Array<Array<number>>} coordinates - Array of [lat, lon] pairs in decimal degrees
 * @returns {number} Area in square meters
 */
function calculatePolygonArea(coordinates) {
    if (!coordinates || coordinates.length < 3) {
        throw new Error('At least 3 coordinates are required');
    }
    
    // WGS84 ellipsoid parameters
    const a = 6378137.0;  // Semi-major axis (meters)
    const f = 1 / 298.257223563;  // Flattening
    const e2 = f * (2 - f);  // First eccentricity squared
    
    // Ensure polygon is closed
    const coords = [...coordinates];
    if (coords[0][0] !== coords[coords.length - 1][0] || 
        coords[0][1] !== coords[coords.length - 1][1]) {
        coords.push(coords[0]);
    }
    
    let area = 0;
    const n = coords.length - 1;
    
    // Calculate area using simplified geodesic excess method
    for (let i = 0; i < n; i++) {
        const [lat1, lon1] = coords[i];
        const [lat2, lon2] = coords[i + 1];
        
        // Convert to radians
        const phi1 = lat1 * Math.PI / 180;
        const phi2 = lat2 * Math.PI / 180;
        let dL = (lon2 - lon1) * Math.PI / 180;
        
        // Normalize longitude difference
        while (dL > Math.PI) dL -= 2 * Math.PI;
        while (dL < -Math.PI) dL += 2 * Math.PI;
        
        // Geodesic excess contribution
        const E = 2 * Math.atan2(
            Math.tan(dL / 2) * (Math.sin(phi1) + Math.sin(phi2)),
            2 + Math.sin(phi1) * Math.sin(phi2) + Math.cos(phi1) * Math.cos(phi2) * Math.cos(dL)
        );
        
        area += E;
    }
    
    // Convert to actual area using ellipsoid parameters
    const ellipsoidArea = Math.abs(area) * (a * a / 2) * (1 - e2);
    
    return ellipsoidArea;
}


function getPolygonCentroid(points) {
    // Simple centroid calculation for small polygons
    let x = 0, y = 0, n = points.length;
    points.forEach(([lat, lon]) => { x += lat; y += lon; });
    return [x / n, y / n];
}

function formatArea(area) {
    if (area > 1e6) return (area / 1e6).toFixed(2) + ' km²';
    if (area > 1e4) return (area / 1e4).toFixed(2) + ' ha';
    return area.toFixed(2) + ' m²';
}

export {generateGeodesicPoints, calculatePolygonArea, getPolygonCentroid, formatArea};
    // calculatePolygonArea