from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse
from pydantic import BaseModel, Field
import requests
from geopy.geocoders import Nominatim
import geopy.distance
from cachetools import TTLCache

app = FastAPI()

loc = Nominatim(user_agent="GetLoc")

class Geodistance(BaseModel):
    lat1: float = Field(..., ge=-90, le=90)
    lon1: float = Field(..., ge=-180, le=180)
    lat2: float = Field(..., ge=-90, le=90)
    lon2: float = Field(..., ge=-180, le=180)
    unit: str = "km"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Replace with your frontend domain in prod
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

summary_cache = TTLCache(maxsize=100, ttl=300)  # ttl time in seconds, then cache expires
full_page_cache = TTLCache(maxsize=100, ttl=300)

@app.get("/")
def health_check():
    return {"status": "ok"}

@app.get("/wiki/{page_name}")
async def get_wiki_page(page_name: str, background_tasks: BackgroundTasks):
    if page_name in summary_cache:
        # print("Cache hit for summary:", page_name) #Working
        return JSONResponse(content=summary_cache[page_name], status_code=200)
    response = requests.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{page_name}", timeout=10)

    if response.status_code != 200:
        return JSONResponse(
            content={"error": "Page not found"},
            status_code=404
        )
    
    coords = loc.geocode(page_name)
    
    result = {
            "title": page_name,
            "content": f"{response.json().get('extract', 'No content available')}",
            "latitude": coords.latitude if coords else None,
            "longitude": coords.longitude if coords else None
        }
    
    background_tasks.add_task(lambda: summary_cache.__setitem__(page_name, result))


    return JSONResponse(
        content= result,
        status_code=200
    )

@app.get("/wiki/search/{full_page}")
def search_wiki(full_page: str, background_tasks: BackgroundTasks):
    if full_page in full_page_cache:
        # print("Cache hit for full_page:", full_page) #Working
        return JSONResponse(content=full_page_cache[full_page], status_code=200)
    
    response = requests.get(f"https://en.wikipedia.org/wiki/{full_page}", timeout=10)
    try:
        if response.status_code != 200:
            return JSONResponse(
                content={"error": "Page not found"},
                status_code=404
            )

        coords = loc.geocode(full_page)

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

@app.get("/random")
def random():
    import cachetools
    return JSONResponse(
        content={
            "message": "This endpoint is not implemented yet.",
            "cachetools": cachetools.__version__
        },
        status_code=501
    )