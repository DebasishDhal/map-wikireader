---
title: Map-WikiReader
emoji: 🫡🥸
colorFrom: pink
colorTo: blue
sdk: docker
pinned: false
---
# Goal
- Combine map exploration and wiki reading.

## Motivation
- I am a map addict. While exploring Google maps, I keep a chrome tab open for checking out random places. 
- Having a handy tool to quickly look up at wiki page of random locations would be a plus.


## Quick remote access
- Use `ngrok` for frontend, `ngrok http 3000` (Since it doesnt have the password issue)
- Use `localtunnel` for backend, `ngrok http 8004` (I don't want remote users to have to enter password or click on a suspicious looking link).
- It works, I tested it on my phone, but it doesn't work on sandbox, most likely due to sandbox's requirement of `Authentication` from backend. Throws an `Error 511`.
- Unfortunately, user still has to visit the `localtunnel` link to avoid `Network Authentication` issue. For that they would reuire the `localtunnel` link, and a password, which can be obtianed from `https://loca.lt/mytunnelpassword`, on the device that is hosting the codebase.

## Resources
- [Geodesic Area calculator](https://geographiclib.sourceforge.io/cgi-bin/Planimeter?type=polygon&rhumb=geodesic&radius=6378137&flattening=1%2F298.257223563&input=40.7128%2C+-74.0060%0D%0A34.0522%2C+-118.2437%0D%0A51.5074%2C+0.1278&option=Submit)
- [Area calculator function in geographiclib-geodesic module's codebase](https://github.com/geographiclib/geographiclib-js/blob/main/geodesic/PolygonArea.js)
- [Country border data](https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson)