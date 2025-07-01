// Haversine-based geodesic interpolator
function generateGeodesicPoints(lat1, lon1, lat2, lon2, numPoints = 128) {
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

export default generateGeodesicPoints;