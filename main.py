from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
# from pydantic import BaseModel
import requests
from geopy.geocoders import Nominatim

app = FastAPI()

loc = Nominatim(user_agent="GetLoc")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Replace with your frontend domain in prod
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def health_check():
    return {"status": "ok"}

@app.get("/wiki/{page_name}")
async def get_wiki_page(page_name: str):
    response = requests.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{page_name}", timeout=10)

    if response.status_code != 200:
        return JSONResponse(
            content={"error": "Page not found"},
            status_code=404
        )
    
    coords = loc.geocode(page_name)
    
    return JSONResponse(
        content={
            "title": page_name,
            "content": f"{response.json().get('extract', 'No content available')}",
            "latitude": coords.latitude if coords else None,
            "longitude": coords.longitude if coords else None
        },
        status_code=200
    )