import math
import httpx

def generate_circle_centers(center_lat, center_lon, radius_km, small_radius_km=10):
    """
        Generate a list of centers of small circles (radius=10km) needed to cover a larger circle.
        Circles are arranged in hexagonal pattern to minimize # of small circles.
        No overlapping among small circles, but some small circles may be outside the larger circle.
        Input:
        - center_lat: Latitude of the center of the larger circle
        - center_lon: Longitude of the center of the larger circle
        - radius_km: Radius of the larger circle in kilometers
        - small_radius_km: Radius of the smaller circles in kilometers (default 10km, more than that wiki api cannot accomodate)

        Output:
        - A list of tuples, each containing the latitude and longitude of a small circle's center. [(lat1, lon1), (lat2, lon2),...]
    """
    R = 6371  # Earth radius

    dx = 2 * small_radius_km
    dy = math.sqrt(3) * small_radius_km
    max_dist = radius_km + small_radius_km

    results = []
    lat_rad = math.radians(center_lat)
    n_y = int(max_dist // dy) + 2

    for row in range(-n_y, n_y + 1):
        y = row * dy
        offset = 0 if row % 2 == 0 else dx / 2
        n_x = int((max_dist + dx) // dx) + 2

        for col in range(-n_x, n_x + 1):
            x = col * dx + offset
            distance = math.sqrt(x ** 2 + y ** 2)

            if distance <= max_dist:
                delta_lat = (y / R) * (180 / math.pi)
                delta_lon = (x / (R * math.cos(lat_rad))) * (180 / math.pi)

                lat = center_lat + delta_lat
                lon = center_lon + delta_lon
                results.append((lat, lon))
    
    return results



async def fetch_url(client: httpx.AsyncClient, url: str):
    """
        Fetch a URL asynchronously using httpx and return the response status and data.
        This function is asynchrounously used to fetch multiple URLs in parallel when search radius > 10km.
        Input:
        - client: httpx.AsyncClient instance
        - url: URL to fetch
        Output:
        - A dictionary with the URL, status code, and data if available.
            - Data includes the JSON format of wiki geosearch response.
        If an error occurs, return a dictionary with the URL and the error message.
    """
    try:
        response = await client.get(url, timeout=10.0)
        return {
            "url": url,
            "status": response.status_code,
            "data": response.json() if response.status_code == 200 else None,
        }
    except Exception as e:
        return {"url": url, "error": str(e)}