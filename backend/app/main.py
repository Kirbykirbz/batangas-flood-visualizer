from fastapi import FastAPI
from pydantic import BaseModel
from typing import List
import psycopg2
import json

app = FastAPI()

# Pydantic model for DEM data
class DEMPoint(BaseModel):
    x: float
    y: float
    z: float

# Connect to Supabase Postgres
conn = psycopg2.connect(
    host="Yaws-1-ap-southeast-2.pooler.supabase.com",
    dbname="postgres",
    user="postgres",
    password="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpeXl6ZXliamV1aWdleXpxbGJ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTAyMzgzMiwiZXhwIjoyMDg2NTk5ODMyfQ.fTZa5-K45siny3Mc6AIX74gsRWLbD6V4c0DlmV9L8Lo
",
    port=5432,
    sslmode="require"
)

@app.get("/dem")
def get_dem_points(limit: int = 1000):
    cur = conn.cursor()
    cur.execute(f"SELECT ST_AsGeoJSON(geom), z FROM dem_points LIMIT {limit}")
    rows = cur.fetchall()
    data = [{"geom": json.loads(row[0]), "z": row[1]} for row in rows]
    return {"data": data}

# Example endpoint for predicted flood pathways
@app.post("/predict")
def predict_flood(rainfall_mm: float, duration_h: float):
    # Call your ML model here
    return {"predicted_pathways": []}  # placeholder
