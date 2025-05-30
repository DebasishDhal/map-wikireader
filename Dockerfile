FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements.txt from the backend folder to the container
COPY requirements.txt .

# Install the dependencies specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code (main.py) into the container
COPY main.py /app/main.py

# Command to run the FastAPI app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
