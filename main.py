from fastapi import FastAPI, BackgroundTasks, Request, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.openapi.docs import get_swagger_ui_html
from pydantic import BaseModel, Field
from typing import Optional
import requests, httpx, asyncio
from geopy.geocoders import Nominatim
import geopy.distance
from cachetools import TTLCache
import os
from dotenv import load_dotenv
from random import sample
from backend.utils import generate_circle_centers, fetch_url, if_page_belongs_to_theme
from mangum import Mangum
from backend.logger.logger_setup import normal_logger as logger
def load_environment():
    """
    Load environment variables from a .env file based on the mode (development or production).
    """
    dotenv_path = ".env" 
    load_dotenv(dotenv_path) 

    mode = os.getenv("MODE", "").lower()

    if mode in ["development", "dev"]:
        mode = "DEVELOPMENT"
    elif mode in ["production", "prod"]:
        mode = "PRODUCTION"
    else:
        return {"status": "error"}

    return {"status": "ok", "mode": mode}

    



loadenv_response = load_environment()
mode = loadenv_response.get("mode")
if mode == "error":
    logger.error("Error loading environment variables. Please check the .env file.")
    exit(1)

if mode == "PRODUCTION":
    app = FastAPI(
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
elif mode == "DEVELOPMENT":
    app = FastAPI()

else:
    logger.error("Invalid mode. Please check the .env file.")
    exit(1)

loc = Nominatim(user_agent="GetLoc")

frontend_urls = os.getenv("ALLOWED_ORIGINS"+"_"+mode, "").split(", ")

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
    theme: Optional[str] = Field(default = None, description="Theme of the pages to return")

app.add_middleware(

    CORSMiddleware,
    allow_origins=frontend_urls,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BACKEND_WIKI_CACHE_TTL = int(os.getenv("BACKEND_WIKI_CACHE_TTL"+"_"+mode, 300))
summary_cache = TTLCache(maxsize=100, ttl=BACKEND_WIKI_CACHE_TTL)  # ttl time in seconds, then cache expires
full_page_cache = TTLCache(maxsize=100, ttl=BACKEND_WIKI_CACHE_TTL)

logger.debug("running", verbosity=1)
logger.debug(f"Backend Wiki Cache TTL: {BACKEND_WIKI_CACHE_TTL}", verbosity=1)
@app.get("/")
def health_check():
    return {"status": "ok"}

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
            response = await client.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{summary_page_name}", timeout=10, headers=HEADERS)

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
        
        # background_tasks.add_task(lambda: summary_cache.__setitem__(summary_page_name, result))


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
        logger.debug(f"Cache hit for full_page: {full_page}") #Working
        return JSONResponse(content=full_page_cache[full_page], status_code=200)
    
    async with httpx.AsyncClient() as client:
        response = await client.get(f"https://en.wikipedia.org/wiki/{full_page}", timeout=10, headers=HEADERS)
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
        
        # background_tasks.add_task(lambda: full_page_cache.__setitem__(full_page, result))

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



    
HEADERS = {
    'User-Agent': 'map-wikireader/1.0 (contact: your-email@example.com) python-http-client'
}

@app.post("/wiki/nearby")
async def get_nearby_wiki_pages(payload: NearbyWikiPage):
    """
    Returns a list of wikipedia pages whose geographical coordinates are within a specified radius from a given location.
    """
    lat_center, lon_center = payload.lat, payload.lon
    radius = payload.radius
    limit = payload.limit
    theme = payload.theme
    wiki_geosearch_radius_limit_meters = 10_000  # Wikipedia API limit

    if radius <= wiki_geosearch_radius_limit_meters:
        url = (
            "https://en.wikipedia.org/w/api.php?action=query"
            "&list=geosearch"
            f"&gscoord={lat_center}|{lon_center}"
            f"&gsradius={radius}"
            f"&gslimit={limit}"
            "&format=json"
        )
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=HEADERS, timeout=10)
            if response.status_code != 200:
                return JSONResponse(content={"error": "Failed to fetch nearby pages"}, status_code=500)
            data = response.json()
            pages = data.get("query", {}).get("geosearch", [])
            if theme:
                pages_theme_validation = await asyncio.gather(
                    *[if_page_belongs_to_theme(page.get("pageid"), theme) for page in pages]
                )
                # pages_theme_validation returns False or dict as per backend/utils.py
                theme_pages = [pages[i] for i, r in enumerate(pages_theme_validation) if r]
                pages = theme_pages
            if len(pages) > limit:
                from random import sample
                pages = sample(pages, limit)
            return JSONResponse(content={"pages": pages, "count": len(pages)}, status_code=200)
        except Exception as e:
            return JSONResponse(content={"error": str(e)}, status_code=500)
    else:
        # radius > wiki_geosearch_radius_limit_meters
        all_pages = []
        from backend.utils import generate_circle_centers, fetch_url, if_page_belongs_to_theme
        small_circle_centers = generate_circle_centers(lat_center, lon_center, radius / 1000, small_radius_km=10)
        base_url = "https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord={lat}|{lon}&gsradius=10000&gslimit=100&format=json"
        urls = [base_url.format(lat=center[0], lon=center[1]) for center in small_circle_centers]
        try:
            async with httpx.AsyncClient(headers=HEADERS) as client:
                tasks = [fetch_url(client, url) for url in urls]
                results = await asyncio.gather(*tasks)
            seen_ids = set()
            for result in results:
                for unit in result.get("data", {}).get("query", {}).get("geosearch", []):
                    pageid = unit.get("pageid")
                    if pageid not in seen_ids:
                        seen_ids.add(pageid)
                        lat, lon = unit.get("lat"), unit.get("lon")
                        if lat is not None and lon is not None:
                            dist = int(
                                __import__('geopy.distance').distance.distance(
                                    (lat_center, lon_center),
                                    (lat, lon)
                                ).m
                            )
                        else:
                            dist = None
                        if (not dist) or (dist > radius):
                            continue
                        unit_with_dist = {**unit, "dist": dist}
                        all_pages.append(unit_with_dist)
            final_results = all_pages
            if theme:
                from backend.utils import if_page_belongs_to_theme
                theme_based_results = []
                tasks = [if_page_belongs_to_theme(unit.get("pageid"), theme) for unit in all_pages]
                theme_results = await asyncio.gather(*tasks)
                theme_based_results = [all_pages[i] for i, r in enumerate(theme_results) if r]
                final_results = theme_based_results
            if len(final_results) > limit:
                from random import sample
                final_results = sample(final_results, limit)
            return JSONResponse(content={"pages": final_results, "count": len(final_results)}, status_code=200)
        except Exception as e:
            return JSONResponse(content={"error": str(e)}, status_code=500)

@app.get("/random")
def random():
    url = "https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=54.163337|37.561109&gsradius=10000&gslimit=10&format=json"
    response = requests.get(url, timeout=10, headers=HEADERS)

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
