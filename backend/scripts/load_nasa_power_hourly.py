from pathlib import Path
import pandas as pd

INCH_TO_MM = 25.4

# -------------------------------------------------
# PATHS
# -------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
CSV_PATH = BASE_DIR / "data" / "raw" / "power_hourly_2026.csv"

# -------------------------------------------------
# FIND HEADER LINE
# -------------------------------------------------
header_line_index = None
with open(CSV_PATH, "r", encoding="utf-8", errors="ignore") as f:
    for i, line in enumerate(f):
        if line.strip() == "YEAR,MO,DY,HR,PRECTOTCORR":
            header_line_index = i
            break

if header_line_index is None:
    raise RuntimeError(
        f"Could not find header line 'YEAR,MO,DY,HR,PRECTOTCORR' in:\n{CSV_PATH}"
    )

# -------------------------------------------------
# READ CSV
# -------------------------------------------------
df = pd.read_csv(CSV_PATH, skiprows=header_line_index)
df.columns = [c.strip().replace("\ufeff", "") for c in df.columns]

print("✅ Loaded:", CSV_PATH)
print("✅ Columns:", df.columns.tolist())
print(df.head())

# -------------------------------------------------
# CLEAN DATA
# -------------------------------------------------
df["PRECTOTCORR"] = pd.to_numeric(df["PRECTOTCORR"], errors="coerce")
df.loc[df["PRECTOTCORR"] == -999, "PRECTOTCORR"] = pd.NA

# -------------------------------------------------
# TIMESTAMP (UTC)
# -------------------------------------------------
dt_parts = df.rename(
    columns={"YEAR": "year", "MO": "month", "DY": "day", "HR": "hour"}
)[["year", "month", "day", "hour"]]

df["ts"] = pd.to_datetime(dt_parts, utc=True, errors="coerce")
df = df[df["ts"].notna()].copy()

# -------------------------------------------------
# CONVERT inches/hour -> mm/hour
# -------------------------------------------------
df["rain_mm_hr"] = df["PRECTOTCORR"] * INCH_TO_MM

# keep clean rows
rain = df[["ts", "rain_mm_hr"]].dropna().sort_values("ts")

# rolling sums (flood-relevant)
rain = rain.set_index("ts").sort_index()

# NOTE: pandas in your env requires lowercase time units: "h" not "H"
rain["rain_3h_mm"] = rain["rain_mm_hr"].rolling("3h").sum()
rain["rain_6h_mm"] = rain["rain_mm_hr"].rolling("6h").sum()
rain["rain_24h_mm"] = rain["rain_mm_hr"].rolling("24h").sum()

rain = rain.reset_index()

print("\n✅ Processed preview:")
print(rain.head())
print("\n✅ Rows processed:", len(rain))
