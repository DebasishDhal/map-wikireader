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
- [Link to resolve pydantic error on AWS Lambda](https://github.com/pydantic/pydantic/issues/6557#issuecomment-2402571329)

## Deployment (Without CI/CD)

- First of all calm down, take a backseat and relax

### AWS Lambda (Backend)

- AWS Lambda requires all the python packages and the function files, as it doesn't have the packages installed.

- AWS Lambda architecture should have x86 architecture.

- Make a folder lambda_build, put main.py and all the py code files keeping the structure intact (put the /backend folder i.e.)

- Install all the files in requirements.txt (as it should be in a x86 machine).

- To install the files, use `pip install "pydantic==2.0.2" --platform manylinux2014_x86_64 --target=lambda_build --implementation cp --python-version 3.10 --only-binary=:all: --upgrade` for all the libraries, handle the package name and version. (Automate it in CI/CD pipeline)

- Once the package installation is done, time for zipping.

- Go inside the lambda_build folder, select all files/folder, zip, upload it to Lambda function.

- Handle the main python file. If your main file is main.py, your handler should be main.handle (if handle = Mangum(app)), these names are flexible. If main file is lamba_function.py (with lambda_handle = Mangum(app)), then handle is lambda_function.lambda_hanle.

- Add environment files as needed on lambda. A functional url will pop up which should show {"status" : "ok"}

### AWS S3 Bucket (Frontend)

- Make a build file (npm run build)
- S3 -> my bucket -> Properties -> Static website hosting: Enable it. Set `index.html` as both source and and error doc.
- Push all the files to your S3 bucket (just the content of build, not the build folder itself)
- Set the bucket policy as
`{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadGetObject",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::my-map-frontend/*"
  }]
}`
- Block all public access (Turn off 'Turn off all public access`)
- In properties, get a url to the bucket, put it inside the allowed origins of backend (Lambda)
- That's it.