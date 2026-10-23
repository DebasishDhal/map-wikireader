from fastapi import FastAPI, BackgroundTasks, Request, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from fastapi.openapi.docs import get_swagger_ui_html
from starlette.exceptions import HTTPException as StarletteHTTPException
from pydantic import BaseModel, Field
from typing import Optional
import requests, httpx, asyncio
import traceback
from pathlib import Path
from geopy.geocoders import Nominatim
import geopy.distance
from cachetools import TTLCache
import os
from dotenv import dotenv_values
from random import sample, random as random_float
from math import asin, degrees
from backend.utils import generate_circle_centers, fetch_url, if_page_belongs_to_theme
from mangum import Mangum
from backend.logger.logger_setup import normal_logger as logger
from backend.persistence import db, current_user, record_activity
def load_environment():
    """
    Load common settings, then the selected environment file. Existing process
    variables (for example Lambda or Compose settings) take precedence.
    """
    externally_configured = set(os.environ)
    for key, value in dotenv_values(".env").items():
        if value is not None:
            os.environ.setdefault(key, value)

    mode = os.getenv("MODE", "").lower()

    if mode in ["development", "dev"]:
        mode = "DEVELOPMENT"
    elif mode in ["production", "prod"]:
        mode = "PRODUCTION"
    else:
        return {"status": "error"}

    # Environment-specific settings override common defaults, but never values
    # supplied directly by the runtime environment.
    for key, value in dotenv_values(f".env.{mode.lower()}").items():
        if value is not None and key not in externally_configured:
            os.environ[key] = value

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

class SearchRecord(BaseModel):
    query: str
    search_type: str = "wikipedia"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius_m: Optional[int] = None
    theme: Optional[str] = None
    result_count: Optional[int] = None

class LocationRecord(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    title: str
    description: Optional[str] = None
    wikipedia_page_id: int
    visibility: str = "private"

class ListRecord(BaseModel):
    name: str
    description: str = ""
    visibility: str = "private"

class ListItemRecord(BaseModel):
    location_id: str
    note: Optional[str] = None
    position: Optional[int] = None

class ReorderRecord(BaseModel):
    location_ids: list[str]

class CognitoCodeExchange(BaseModel):
    code: str
    code_verifier: str

app.add_middleware(

    CORSMiddleware,
    allow_origins=frontend_urls,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _failure_source(error):
    """Return the first application source frame that raised an exception."""
    for frame in reversed(traceback.extract_tb(error.__traceback__)):
        if frame.name in {"log_http_error", "log_unhandled_error"}:
            continue
        try:
            source = Path(frame.filename).resolve().relative_to(Path(__file__).resolve().parent)
        except ValueError:
            continue
        return f"{source}:{frame.lineno} in {frame.name}()"
    return "application source unavailable"


@app.exception_handler(StarletteHTTPException)
async def log_http_error(request: Request, error: StarletteHTTPException):
    source = _failure_source(error)
    detail = error.detail if isinstance(error.detail, str) else repr(error.detail)
    message = "HTTP %s %s %s source=%s detail=%s"
    arguments = (error.status_code, request.method, request.url.path, source, detail)
    if error.status_code >= 500:
        logger.error(message, *arguments, exc_info=(type(error), error, error.__traceback__))
    else:
        logger.warning(message, *arguments)
    return JSONResponse(status_code=error.status_code, content=jsonable_encoder({"detail": error.detail}), headers=error.headers)


@app.exception_handler(RequestValidationError)
async def log_request_validation_error(request: Request, error: RequestValidationError):
    fields = [{"field": ".".join(map(str, item.get("loc", ()))), "message": item.get("msg"), "type": item.get("type")}
              for item in error.errors()]
    logger.warning("Request validation failed: %s %s fields=%s", request.method, request.url.path, fields)
    return JSONResponse(status_code=422, content=jsonable_encoder({"detail": error.errors()}))


@app.exception_handler(Exception)
async def log_unhandled_error(request: Request, error: Exception):
    source = _failure_source(error)
    logger.error("Unhandled request error: %s %s source=%s", request.method, request.url.path, source,
                 exc_info=(type(error), error, error.__traceback__))
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

BACKEND_WIKI_CACHE_TTL = int(os.getenv("BACKEND_WIKI_CACHE_TTL"+"_"+mode, 300))
summary_cache = TTLCache(maxsize=100, ttl=BACKEND_WIKI_CACHE_TTL)  # ttl time in seconds, then cache expires
full_page_cache = TTLCache(maxsize=100, ttl=BACKEND_WIKI_CACHE_TTL)

logger.debug("running", verbosity=1)
logger.debug(f"Backend Wiki Cache TTL: {BACKEND_WIKI_CACHE_TTL}", verbosity=1)
@app.get("/")
def health_check():
    return {"status": "ok"}

@app.post("/api/auth/token")
def exchange_cognito_code(payload: CognitoCodeExchange):
    """Exchange a Cognito authorization code without exposing the app secret to the browser."""
    domain = os.getenv("COGNITO_DOMAIN")
    client_id = os.getenv("COGNITO_CLIENT_ID")
    client_secret = os.getenv("COGNITO_CLIENT_SECRET")
    redirect_uri = os.getenv("COGNITO_REDIRECT_URI")
    if not all((domain, client_id, client_secret, redirect_uri)):
        raise HTTPException(503, "Cognito token exchange is not configured on the backend")

    token_url = f"https://{domain.removeprefix('https://').removeprefix('http://').rstrip('/')}/oauth2/token"
    try:
        response = requests.post(token_url, data={
            "grant_type": "authorization_code",
            "client_id": client_id,
            "client_secret": client_secret,
            "code": payload.code,
            "redirect_uri": redirect_uri,
            "code_verifier": payload.code_verifier,
        }, headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=15)
    except requests.RequestException:
        logger.exception("Cognito token endpoint request failed")
        raise HTTPException(502, "Could not contact the Cognito token endpoint")

    try:
        token_response = response.json()
    except ValueError:
        token_response = {}
    if not response.ok:
        logger.warning("Cognito token exchange rejected with status %s", response.status_code)
        raise HTTPException(response.status_code if 400 <= response.status_code < 500 else 502,
                            token_response.get("error_description") or token_response.get("error") or "Cognito sign-in failed")
    if not token_response.get("id_token") or not token_response.get("access_token"):
        raise HTTPException(502, "Cognito returned an incomplete token response")
    return token_response

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
            raise HTTPException(404, "Wikipedia page not found")
        try:
            coords = loc.geocode(summary_page_name, timeout=5)
        except Exception:
            logger.warning("Wikipedia summary geocoding failed for page=%r", summary_page_name, exc_info=True)
            coords = None
        
        result = {
                "title": summary_page_name,
                "content": f"{response.json().get('extract', 'No content available')}",
                "latitude": coords.latitude if coords else None,
                "longitude": coords.longitude if coords else None,
                "wikipedia_page_id": response.json().get("pageid")
            }
        
        # background_tasks.add_task(lambda: summary_cache.__setitem__(summary_page_name, result))


        return JSONResponse(
            content= result,
            status_code=200
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Wikipedia summary request failed for page=%r", summary_page_name)
        return JSONResponse(content={"error": "Could not retrieve Wikipedia summary"}, status_code=502)

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
            raise HTTPException(404, "Wikipedia page not found")
        try:
            coords = loc.geocode(full_page, timeout=5)
        except Exception:
            logger.warning("Wikipedia page geocoding failed for page=%r", full_page, exc_info=True)
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
    
    except HTTPException:
        raise
    except Exception:
        logger.exception("Wikipedia full-page request failed for page=%r", full_page)
        return JSONResponse(content={"error": "Could not retrieve Wikipedia page"}, status_code=502)


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
            raise HTTPException(400, "Invalid distance unit; use 'km' or 'mi'")
        
    except HTTPException:
        raise
    except Exception:
        logger.exception("Geodistance calculation failed for coordinates=%s,%s to %s,%s unit=%r", lat1, lon1, lat2, lon2, unit)
        return JSONResponse(content={"error": "Could not calculate distance"}, status_code=500)
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
                logger.error("Wikipedia nearby search failed: upstream_status=%s center=%s,%s radius_m=%s", response.status_code, lat_center, lon_center, radius)
                return JSONResponse(content={"error": "Could not fetch nearby Wikipedia pages"}, status_code=502)
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
        except Exception:
            logger.exception("Nearby Wikipedia search failed center=%s,%s radius_m=%s", lat_center, lon_center, radius)
            return JSONResponse(content={"error": "Could not fetch nearby Wikipedia pages"}, status_code=502)
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
        except Exception:
            logger.exception("Large-radius nearby search failed center=%s,%s radius_m=%s", lat_center, lon_center, radius)
            return JSONResponse(content={"error": "Could not fetch nearby Wikipedia pages"}, status_code=502)

@app.get("/wiki/page-summary/{page_id}")
async def get_wiki_page_summary(page_id: int):
    """Fetch a short plain-text extract for a Wikipedia page by its page ID."""
    url = "https://en.wikipedia.org/w/api.php"
    params = {
        "action": "query",
        "prop": "extracts",
        "exintro": 1,
        "explaintext": 1,
        "pageids": page_id,
        "format": "json",
    }
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, headers=HEADERS, timeout=10)
        if response.status_code != 200:
            raise HTTPException(502, "Could not fetch this Wikipedia page")
        pages = response.json().get("query", {}).get("pages", {})
        page = pages.get(str(page_id))
        if not page or page.get("missing") is not None:
            raise HTTPException(404, "Wikipedia page not found")
        return {"page_id": page_id, "title": page.get("title"), "extract": page.get("extract") or "No summary is available for this page."}
    except httpx.RequestError:
        raise HTTPException(502, "Could not contact Wikipedia")

@app.get("/random")
async def random_wikipedia_location():
    """Pick a random point on Earth and return a nearby geotagged Wikipedia page."""
    url = "https://en.wikipedia.org/w/api.php"
    try:
        async with httpx.AsyncClient() as client:
            for attempt in range(1, 13):
                latitude = degrees(asin(2 * random_float() - 1))
                longitude = random_float() * 360 - 180
                try:
                    response = await client.get(url, params={
                        "action": "query",
                        "list": "geosearch",
                        "gscoord": f"{latitude}|{longitude}",
                        "gsradius": 10000,
                        "gslimit": 1,
                        "format": "json",
                    }, headers=HEADERS, timeout=8)
                except httpx.RequestError:
                    logger.warning("Random Wikipedia lookup attempt %d/12 failed during geosearch", attempt, exc_info=True)
                    continue
                if response.status_code != 200:
                    logger.warning("Random Wikipedia lookup attempt %d/12 returned upstream status %s", attempt, response.status_code)
                    continue
                try:
                    pages = response.json().get("query", {}).get("geosearch", [])
                except (ValueError, AttributeError):
                    logger.warning("Random Wikipedia lookup attempt %d/12 returned invalid geosearch JSON", attempt, exc_info=True)
                    continue
                if not pages:
                    continue
                page = sample(pages, 1)[0]
                try:
                    summary = await get_wiki_page_summary(int(page["pageid"]))
                except (KeyError, ValueError, HTTPException):
                    logger.warning("Random Wikipedia lookup attempt %d/12 could not load summary for page=%r", attempt, page.get("pageid"), exc_info=True)
                    continue
                if not summary or not summary.get("title"):
                    logger.warning("Random Wikipedia lookup attempt %d/12 got an empty summary for page=%r", attempt, page.get("pageid"))
                    continue
                return {
                    "page_id": page["pageid"],
                    "title": page["title"],
                    "latitude": page["lat"],
                    "longitude": page["lon"],
                    "extract": summary["extract"],
                }

    except Exception:
        logger.exception("Random Wikipedia location lookup crashed")
        raise HTTPException(503, "Could not find a random Wikipedia location. Please try again.")


@app.get("/api/me")
def get_profile(user=Depends(current_user), conn=Depends(db)):
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM lists WHERE user_id=%s ORDER BY is_default DESC,updated_at DESC", (user["id"],))
        lists = cur.fetchall()
        cur.execute("SELECT * FROM searches WHERE user_id=%s ORDER BY created_at DESC LIMIT 50", (user["id"],))
        searches = cur.fetchall()
        cur.execute("SELECT * FROM user_activities WHERE user_id=%s ORDER BY created_at DESC LIMIT 100", (user["id"],))
        activities = cur.fetchall()
        cur.execute("SELECT * FROM locations WHERE user_id=%s ORDER BY created_at DESC", (user["id"],))
        locations = cur.fetchall()
        cur.execute("SELECT list_locations.location_id,list_locations.list_id FROM list_locations JOIN lists ON lists.id=list_locations.list_id WHERE lists.user_id=%s", (user["id"],))
        memberships = cur.fetchall()
    memberships_by_location = {}
    for membership in memberships:
        memberships_by_location.setdefault(str(membership["location_id"]), []).append(str(membership["list_id"]))
    for location in locations:
        location["list_ids"] = memberships_by_location.get(str(location["id"]), [])
    return {"user": user, "lists": lists, "searches": searches, "activities": activities, "locations": locations}

@app.post("/api/searches")
def save_search(record: SearchRecord, user=Depends(current_user), conn=Depends(db)):
    with conn.cursor() as cur:
        cur.execute("INSERT INTO searches (user_id,query,search_type,latitude,longitude,radius_m,theme,result_count) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
                    (user["id"], record.query, record.search_type, record.latitude, record.longitude, record.radius_m, record.theme, record.result_count))
        row = cur.fetchone()
        record_activity(conn, user["id"], "search", {"query": record.query, "search_type": record.search_type})
    conn.commit()
    return row

@app.get("/api/searches")
def list_searches(user=Depends(current_user), conn=Depends(db)):
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM searches WHERE user_id=%s ORDER BY created_at DESC LIMIT 100", (user["id"],))
        return cur.fetchall()

@app.patch("/api/searches/latest")
def update_search_result_count(query: str, result_count: int, user=Depends(current_user), conn=Depends(db)):
    with conn.cursor() as cur:
        cur.execute("UPDATE searches SET result_count=%s WHERE id=(SELECT id FROM searches WHERE user_id=%s AND query=%s ORDER BY created_at DESC LIMIT 1) RETURNING *",
                    (result_count, user["id"], query))
        row = cur.fetchone()
    conn.commit()
    return row or {"status": "not_found"}

@app.post("/api/locations")
def save_location(record: LocationRecord, user=Depends(current_user), conn=Depends(db)):
    if record.visibility not in ("public", "private"):
        raise HTTPException(422, "Visibility must be public or private")
    with conn.cursor() as cur:
        cur.execute("INSERT INTO locations (user_id,latitude,longitude,title,description,visibility,wikipedia_page_id) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *",
                    (user["id"], record.latitude, record.longitude, record.title, record.description, record.visibility, record.wikipedia_page_id))
        location = cur.fetchone()
        record_activity(conn, user["id"], "location_saved", {"location_id": str(location["id"]), "title": record.title})
    conn.commit()
    return location

@app.get("/api/locations")
def list_locations(user=Depends(current_user), conn=Depends(db)):
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM locations WHERE user_id=%s ORDER BY created_at DESC", (user["id"],))
        return cur.fetchall()

@app.post("/api/lists")
def create_list(record: ListRecord, user=Depends(current_user), conn=Depends(db)):
    if record.visibility not in ("public", "private"):
        raise HTTPException(422, "Visibility must be public or private")
    with conn.cursor() as cur:
        cur.execute("INSERT INTO lists (user_id,name,description,visibility) VALUES (%s,%s,%s,%s) RETURNING *", (user["id"], record.name, record.description, record.visibility))
        result = cur.fetchone()
        record_activity(conn, user["id"], "collection_created", {"list_id": str(result["id"]), "name": record.name})
    conn.commit()
    return result

@app.patch("/api/lists/{list_id}")
def update_list(list_id: str, record: ListRecord, user=Depends(current_user), conn=Depends(db)):
    if record.visibility not in ("public", "private"):
        raise HTTPException(422, "Visibility must be public or private")
    with conn.cursor() as cur:
        cur.execute("UPDATE lists SET name=%s,description=%s,visibility=%s,updated_at=now() WHERE id=%s AND user_id=%s RETURNING *",
                    (record.name, record.description, record.visibility, list_id, user["id"]))
        result = cur.fetchone()
        if not result:
            raise HTTPException(404, "List not found")
        record_activity(conn, user["id"], "collection_updated", {"list_id": list_id, "visibility": record.visibility})
    conn.commit()
    return result

@app.get("/api/lists/{list_id}")
def get_list(list_id: str, user=Depends(current_user), conn=Depends(db)):
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM lists WHERE id=%s AND (user_id=%s OR visibility='public')", (list_id, user["id"]))
        result = cur.fetchone()
        if not result:
            raise HTTPException(404, "List not found")
        cur.execute("SELECT locations.*,list_locations.position,list_locations.note AS list_note FROM list_locations JOIN locations ON locations.id=list_locations.location_id WHERE list_locations.list_id=%s AND (locations.user_id=%s OR locations.visibility='public') ORDER BY list_locations.position NULLS LAST,list_locations.added_at", (list_id, user["id"]))
        result["locations"] = cur.fetchall()
        return result

@app.post("/api/lists/{list_id}/locations")
def add_list_item(list_id: str, item: ListItemRecord, user=Depends(current_user), conn=Depends(db)):
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM lists WHERE id=%s AND user_id=%s", (list_id, user["id"]))
        if not cur.fetchone():
            raise HTTPException(404, "List not found")
        cur.execute("SELECT id FROM locations WHERE id=%s AND user_id=%s", (item.location_id, user["id"]))
        if not cur.fetchone():
            raise HTTPException(404, "Location not found")
        cur.execute("INSERT INTO list_locations (list_id,location_id,position,note) VALUES (%s,%s,%s,%s) ON CONFLICT (list_id,location_id) DO UPDATE SET note=EXCLUDED.note,position=COALESCE(EXCLUDED.position,list_locations.position)", (list_id, item.location_id, item.position, item.note))
        record_activity(conn, user["id"], "location_added_to_list", {"list_id": list_id, "location_id": item.location_id})
    conn.commit()
    return {"status": "ok"}

@app.delete("/api/lists/{list_id}/locations/{location_id}")
def remove_list_item(list_id: str, location_id: str, user=Depends(current_user), conn=Depends(db)):
    with conn.cursor() as cur:
        cur.execute("DELETE FROM list_locations USING lists WHERE list_locations.list_id=lists.id AND lists.user_id=%s AND list_locations.list_id=%s AND list_locations.location_id=%s",
                    (user["id"], list_id, location_id))
        record_activity(conn, user["id"], "location_removed_from_list", {"list_id": list_id, "location_id": location_id})
    conn.commit()
    return {"status": "ok"}

@app.put("/api/lists/{list_id}/locations/order")
def reorder_list(list_id: str, order: ReorderRecord, user=Depends(current_user), conn=Depends(db)):
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM lists WHERE id=%s AND user_id=%s", (list_id, user["id"]))
        if not cur.fetchone():
            raise HTTPException(404, "List not found")
        for position, location_id in enumerate(order.location_ids):
            cur.execute("UPDATE list_locations SET position=%s WHERE list_id=%s AND location_id=%s", (position, list_id, location_id))
        record_activity(conn, user["id"], "collection_reordered", {"list_id": list_id})
    conn.commit()
    return {"status": "ok"}

@app.get("/api/public/lists/{list_id}")
def public_list(list_id: str, conn=Depends(db)):
    with conn.cursor() as cur:
        cur.execute("SELECT id,name,description FROM lists WHERE id=%s AND visibility='public'", (list_id,))
        result = cur.fetchone()
        if not result:
            raise HTTPException(404, "Public list not found")
        # Publishing a list makes its included locations visible through this share link.
        # Select only fields used by the shared map; do not expose owner-only fields.
        cur.execute("SELECT locations.id,locations.latitude,locations.longitude,locations.title,locations.description,locations.wikipedia_page_id,list_locations.position,list_locations.note AS list_note FROM list_locations JOIN locations ON locations.id=list_locations.location_id WHERE list_locations.list_id=%s ORDER BY list_locations.position NULLS LAST,list_locations.added_at", (list_id,))
        result["locations"] = cur.fetchall()
        return result

lambda_handler = Mangum(app)
