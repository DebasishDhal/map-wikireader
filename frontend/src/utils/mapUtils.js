import LatLon from 'geodesy/latlon-spherical.js';
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


function calculatePolygonArea(coords) {
    if (!coords || coords.length < 3) return { area: 0, perimeter: 0 };

    let area = 0;
    let perimeter = 0;

    const latlonPoints = coords.map(c => new LatLon(c[0], c[1]));

    for (let i = 0; i < latlonPoints.length; i++) {
        const p1 = latlonPoints[i];
        const p2 = latlonPoints[(i + 1) % latlonPoints.length];

        perimeter += p1.distanceTo(p2); // in meters
    }

    area = LatLon.areaOf(latlonPoints); // in square meters

    return { "area":area, "perimeter": perimeter };
}


function getPolygonCentroid(points) {
    // Simple centroid calculation for small polygons
    let x = 0, y = 0, n = points.length;
    points.forEach(([lat, lon]) => { x += lat; y += lon; });
    return [x / n, y / n];
}

function formatArea(area, unit = 'sqm', format = "normal") {

    if (typeof area !== 'number' || isNaN(area)) {
        console.log('Invalid area input:', area);
        return 'Invalid area';
    }
    let value;
    switch (unit) {
        case "km2":
            value = area / 1e6;
            return (format === "scientific" ? value.toExponential(2) : value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })) + ' km²';
        case "ha":
            value = area / 1e4;
            return (format === "scientific" ? value.toExponential(2) : value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })) + ' ha';
        case "acres":
            value = area / 4046.8564224;
            return (format === "scientific" ? value.toExponential(2) : value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })) + ' acres';
        case "mi2":
            value = area / 2589988.110336;
            return (format === "scientific" ? value.toExponential(2) : value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })) + ' mi²';
        case "sqft":
            value = area * 10.76391041671;
            return (format === "scientific" ? value.toExponential(2) : value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })) + ' ft²';
        case "sqm":
        default:
            value = area;
            return (format === "scientific" ? value.toExponential(2) : value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })) + ' m²';
    }
}
function formatPerimeter(perimeter, unit = 'sqm', format = "normal") {
    if (typeof perimeter !== 'number' || isNaN(perimeter)) {
        console.log('Invalid perimeter input:', perimeter);
        return 'Invalid perimeter';
    }
    let value;
    switch (unit) {
        case "km2":
        case "ha":
            value = perimeter / 1000;
            return (format === "scientific" ? value.toExponential(2) : value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })) + ' km';
        case "mi2":
            value = perimeter / 1609.344;
            return (format === "scientific" ? value.toExponential(2) : value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })) + ' mi';
        case "sqft":
            value = perimeter * 3.280839895013123; // meters to feet
            return (format === "scientific" ? value.toExponential(2) : value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })) + ' ft';
        case "m2":
        default:
            value = perimeter;
            return (format === "scientific" ? value.toExponential(2) : value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })) + ' m';
    }
}

export {generateGeodesicPoints, calculatePolygonArea, getPolygonCentroid, formatArea, formatPerimeter};