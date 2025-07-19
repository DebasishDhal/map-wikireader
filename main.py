from fastapi import FastAPI, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.openapi.docs import get_swagger_ui_html
from pydantic import BaseModel, Field
import requests, httpx, asyncio
from geopy.geocoders import Nominatim
import geopy.distance
from cachetools import TTLCache
import os
from dotenv import load_dotenv
from random import sample
from backend.utils import generate_circle_centers, fetch_url
from mangum import Mangum


load_dotenv()

app = FastAPI(
    # docs_url=None,
    # redoc_url=None,
    # openapi_url=None
)

loc = Nominatim(user_agent="GetLoc")

class Geodistance(BaseModel):
    lat1: float = Field(..., ge=-90, le=90)
    lon1: float = Field(..., ge=-180, le=180)
    lat2: float = Field(..., ge=-90, le=90)
    lon2: float = Field(..., ge=-180, le=180)
    unit: str = "km"

class NearbyWikiPage(BaseModel):
    lat: float = Field(default=54.163337, ge=-90, le=90)
    lon: float = Field(default=37.561109, ge=-180, le=180)
    radius: int = Field(default=1000, ge=10, le=100_000,description="Distance in meters from the reference point")
    limit: int = Field(10, ge=1, description="Number of pages to return")

# frontend_urls = origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "").split(", ") if origin.strip()
frontend_urls = os.getenv("ALLOWED_ORIGINS", "").split(", ")

app.add_middleware(

    CORSMiddleware,
    # allow_origins=["*"],
    allow_origins=frontend_urls,  # Replace with your frontend domain in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BACKEND_WIKI_CACHE_TTL = int(os.getenv("BACKEND_WIKI_CACHE_TTL", 300))
summary_cache = TTLCache(maxsize=100, ttl=BACKEND_WIKI_CACHE_TTL)  # ttl time in seconds, then cache expires
full_page_cache = TTLCache(maxsize=100, ttl=BACKEND_WIKI_CACHE_TTL)

@app.get("/")
def health_check():
    return {"status": "ok"}

# @app.get("/docs", include_in_schema=False)
# async def custom_swagger_ui_html(request: Request):
#     origin = request.headers.get("origin")
#     if origin and origin not in frontend_urls:
#         return JSONResponse(status_code=403, content={"detail": "Forbidden"})

#     return get_swagger_ui_html(
#         openapi_url=app.openapi_url,
#         title=app.title + " - Swagger UI"
#     )

# @app.get("/openapi.json")
# async def get_open_api_endpoint(request: Request):
#     origin = request.headers.get("origin")
    
#     if origin and origin not in frontend_urls:
#         return JSONResponse(status_code=403, content={"detail": "Forbidden"})

#     return JSONResponse(app.openapi())

@app.get("/wiki/search/summary/{summary_page_name}")
async def get_wiki_summary(summary_page_name: str, background_tasks: BackgroundTasks):
    """
        This function fetches the summary of a Wikipedia page along with its geographical coordinates.
        It also caches the result in ephemeral in-memory cache in the background.
        Input: summary_page_name: str - Name of the Wikipedia page to fetch summary for.
        Output: {"title": "Page Title", "content": "Summary content here", "latitude": float, "longitude": float9}
    """
    if summary_page_name in summary_cache:
        # print("Cache hit for summary:", page_name) #Working
        return JSONResponse(content=summary_cache[summary_page_name], status_code=200)
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{summary_page_name}", timeout=10)

        if response.status_code != 200:
            return JSONResponse(
                content={"error": "Page not found"},
                status_code=404
            )
        try:
            coords = loc.geocode(summary_page_name, timeout=5)
        except Exception as e:
            coords = None
        
        result = {
                "title": summary_page_name,
                "content": f"{response.json().get('extract', 'No content available')}",
                "latitude": coords.latitude if coords else None,
                "longitude": coords.longitude if coords else None
            }
        
        background_tasks.add_task(lambda: summary_cache.__setitem__(summary_page_name, result))


        return JSONResponse(
            content= result,
            status_code=200
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e), 'response': str(response)},
            status_code=500
        )

@app.get("/wiki/search/full/{full_page}")
async def search_wiki_full_page(full_page: str, background_tasks: BackgroundTasks):
    """
        This function fetches the full content of a Wikipedia page along with its geographical coordinates. 
        It also caches the result in ephemeral in-memory cache in the background.
        Input: full_page: str - Name of the Wikipedia page to fetch full content for.
        Output: {"title": "Page Title", "content": "Full content here", "latitude": float, "longitude": float}
    """
    if full_page in full_page_cache:
        # print("Cache hit for full_page:", full_page) #Working
        return JSONResponse(content=full_page_cache[full_page], status_code=200)
    
    async with httpx.AsyncClient() as client:
        response = await client.get(f"https://en.wikipedia.org/wiki/{full_page}", timeout=10)
    try:
        if response.status_code != 200:
            return JSONResponse(
                content={"error": "Page not found"},
                status_code=404
            )
        try:
            coords = loc.geocode(full_page, timeout=5)
        except Exception as e:
            coords = None

        result = {
                        "title": full_page, 
                        "content": str(response.text),
                        "latitude": coords.latitude if coords else None,
                        "longitude": coords.longitude if coords else None
                }
        
        background_tasks.add_task(lambda: full_page_cache.__setitem__(full_page, result))

        return JSONResponse(
            content= result,
            status_code=200
        )
    
    except Exception as e:
        return JSONResponse(
            content={"error": str(e), 'response': str(response)},
            status_code=500
        )


@app.post("/geodistance")
def get_geodistance(payload: Geodistance):
    """
        Input: "lat1", "lon1", "lat2", "lon2", "unit (km/mi)"
        Output: {"distance": float, "unit": str, "lat1": float, "lon1": float, "lat2": float, "lon2": float}
    """
    lat1, lon1 = payload.lat1, payload.lon1
    lat2, lon2 = payload.lat2, payload.lon2
    unit = payload.unit

    try:
        distance_km = geopy.distance.distance((lat1, lon1), (lat2, lon2)).km
        if unit == "km":
            distance = distance_km
        elif unit == "mi":
            distance = distance_km * 0.621371
        else:
            return JSONResponse(
                content={"error": "Invalid unit"},
                status_code=400
            )
        
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    return JSONResponse(
        content={
            "distance": distance,
            "unit": unit,
            "lat1": lat1,
            "lon1": lon1,
            "lat2": lat2,
            "lon2": lon2
        },
        status_code=200
    )



    
@app.post("/wiki/nearby")
async def get_nearby_wiki_pages(payload: NearbyWikiPage):
    """
    Returns a list of wikipedia pages whose geographical coordinates are within a specified radius from a given location.
    Input:
    - lat: Latitude of the reference point
    - lon: Longitude of the reference point
    - radius: Radius in meters within which to search for pages
    - limit: Maximum number of pages to return

    Output:
        {
            "pages": [
                {
                    "pageid": 123456,
                    "title": "Page Title",
                    "lat": 54.163337,
                    "lon": 37.561109,
                    "dist": 123.45  # Dist. in meters from the reference point
                    ...
                },
                ...
            ],
            "count": 10 #Total no. of such pages
        }
    Example raw respone from Wikipedia API: https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=40.7128%7C-74.0060&gsradius=10000&gslimit=1&format=json
    """
    lat_center, lon_center = payload.lat, payload.lon
    radius = payload.radius
    limit = payload.limit

    wiki_geosearch_radius_limit_meters = 10000 # Wikipedia API limit for geosearch radius in meters

    if radius <= wiki_geosearch_radius_limit_meters:
        url = ("https://en.wikipedia.org/w/api.php"+"?action=query"
                "&list=geosearch"
                f"&gscoord={lat_center}|{lon_center}"
                f"&gsradius={radius}"
                f"&gslimit={limit}"
                "&format=json")

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, timeout=10)
            if response.status_code != 200:
                return JSONResponse(
                    content={"error": "Failed to fetch nearby pages"},
                    status_code=500
                )
            data = response.json()

            pages = data.get("query", {}).get("geosearch", [])

            if len(pages) > limit:
                pages = sample(pages, limit)

            return JSONResponse(
                content={
                    "pages": pages,
                    "count": len(pages)
                },
                status_code=200
            )
        except Exception as e:
            return JSONResponse(
                content={"error": str(e)},
                status_code=500
            )
        
    elif radius > wiki_geosearch_radius_limit_meters:
        all_pages = []

        small_circle_centers = generate_circle_centers(lat_center, lon_center, radius / 1000, small_radius_km=10)
        base_url = "https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord={lat}|{lon}&gsradius={small_radius_km}&gslimit={page_limit}&format=json"
        urls = [base_url.format(lat=center[0], lon=center[1], small_radius_km=wiki_geosearch_radius_limit_meters, page_limit=100) for center in small_circle_centers]

        print("URL Counts:", len(urls))
        try:
            async with httpx.AsyncClient() as client:
                tasks = [fetch_url(client, url) for url in urls]
                results = await asyncio.gather(*tasks)
            
            for result in results:

                for unit in result.get("data", {}).get("query", {}).get("geosearch", []):

                    lat, lon = unit.get("lat"), unit.get("lon")
                    if lat is not None and lon is not None:
                        dist = int(geopy.distance.distance(
                                (lat_center, lon_center), (lat, lon)
                            ).m)
                    else: 
                        dist = None

                    if (not dist) or (dist and dist > radius):
                        continue

                    unit_with_dist = {**unit, "dist": dist}
                    all_pages.append(unit_with_dist)

            if len(all_pages) > limit:
                all_pages = sample(all_pages, limit)

            return JSONResponse(
                content={
                    "pages": all_pages,
                    "count": len(all_pages)
                }
            )
        
        except Exception as e:
            return JSONResponse(
                content={"error": str(e)},
                status_code=500
        )    



@app.get("/random")
def random():
    url = "https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=54.163337|37.561109&gsradius=10000&gslimit=10&format=json"
    response = requests.get(url, timeout=10)

    if response.status_code != 200:
        return JSONResponse(
            content={"error": "Failed to fetch random page"},
            status_code=500
        )
    data = response.json()
    pages = data.get("query", {}).get("geosearch", [])
    if not pages:
        return JSONResponse(
            content={"error": "No pages found"},
            status_code=404
        )
     
    return JSONResponse(
        content={
            "pages": pages,
            "count": len(pages),
            # "urls": frontend_urls
        },
        status_code=200
    )


lambda_handler = Mangum(app)