"""Labels Qloo where_popular heatmap points with the nearest major city (public coordinates)."""
from __future__ import annotations

import math

CITIES: list[tuple[str, float, float]] = [
    ("New York", 40.71, -74.01), ("Los Angeles", 34.05, -118.24), ("Chicago", 41.88, -87.63),
    ("Houston", 29.76, -95.37), ("Phoenix", 33.45, -112.07), ("Philadelphia", 39.95, -75.17),
    ("San Antonio", 29.42, -98.49), ("San Diego", 32.72, -117.16), ("Dallas", 32.78, -96.80),
    ("Austin", 30.27, -97.74), ("Jacksonville", 30.33, -81.66), ("San Jose", 37.34, -121.89),
    ("Columbus", 39.96, -83.00), ("Charlotte", 35.23, -80.84), ("Indianapolis", 39.77, -86.16),
    ("San Francisco", 37.77, -122.42), ("Seattle", 47.61, -122.33), ("Denver", 39.74, -104.99),
    ("Washington, DC", 38.91, -77.04), ("Nashville", 36.16, -86.78), ("Oklahoma City", 35.47, -97.52),
    ("El Paso", 31.76, -106.49), ("Boston", 42.36, -71.06), ("Portland", 45.52, -122.68),
    ("Las Vegas", 36.17, -115.14), ("Detroit", 42.33, -83.05), ("Memphis", 35.15, -90.05),
    ("Louisville", 38.25, -85.76), ("Baltimore", 39.29, -76.61), ("Milwaukee", 43.04, -87.91),
    ("Albuquerque", 35.08, -106.65), ("Tucson", 32.22, -110.97), ("Fresno", 36.74, -119.79),
    ("Sacramento", 38.58, -121.49), ("Kansas City", 39.10, -94.58), ("Atlanta", 33.75, -84.39),
    ("Miami", 25.76, -80.19), ("Orlando", 28.54, -81.38), ("Tampa", 27.95, -82.46),
    ("Raleigh", 35.78, -78.64), ("Minneapolis", 44.98, -93.27), ("New Orleans", 29.95, -90.07),
    ("Cleveland", 41.50, -81.69), ("Pittsburgh", 40.44, -80.00), ("Cincinnati", 39.10, -84.51),
    ("St. Louis", 38.63, -90.20), ("Salt Lake City", 40.76, -111.89), ("Omaha", 41.26, -95.93),
    ("Honolulu", 21.31, -157.86), ("Anchorage", 61.22, -149.90), ("Boise", 43.62, -116.20),
    ("Richmond", 37.54, -77.44), ("Birmingham", 33.52, -86.80), ("Buffalo", 42.89, -78.88),
    ("Wichita", 37.69, -97.34), ("Des Moines", 41.59, -93.62), ("Little Rock", 34.75, -92.29),
    ("Charleston", 32.78, -79.93), ("Spokane", 47.66, -117.43), ("Madison", 43.07, -89.40),
    ("Lincoln, NE", 40.81, -96.70), ("Columbia, SC", 34.00, -81.03), ("Knoxville", 35.96, -83.92),
    ("Toronto", 43.65, -79.38), ("Montreal", 45.50, -73.57), ("Vancouver", 49.28, -123.12),
    ("Mexico City", 19.43, -99.13), ("Guadalajara", 20.66, -103.35), ("Monterrey", 25.69, -100.32),
    ("London", 51.51, -0.13), ("Manchester", 53.48, -2.24), ("Paris", 48.86, 2.35), ("Berlin", 52.52, 13.40),
    ("Madrid", 40.42, -3.70), ("Barcelona", 41.39, 2.17), ("Amsterdam", 52.37, 4.90), ("Dublin", 53.35, -6.26),
    ("Mumbai", 19.08, 72.88), ("Delhi", 28.61, 77.21), ("Bengaluru", 12.97, 77.59), ("Sydney", -33.87, 151.21),
    ("Melbourne", -37.81, 144.96), ("Tokyo", 35.68, 139.69), ("São Paulo", -23.55, -46.63),
    ("Buenos Aires", -34.60, -58.38), ("Bogotá", 4.71, -74.07), ("San Juan", 18.47, -66.11),
]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearest_city(lat: float, lon: float) -> tuple[str, float]:
    best = min(CITIES, key=lambda c: haversine_km(lat, lon, c[1], c[2]))
    return best[0], haversine_km(lat, lon, best[1], best[2])
