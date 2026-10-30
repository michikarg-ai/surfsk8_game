#!/usr/bin/env python3
"""
Downloads the exact Bavarian OpenData DGM1 1m LiDAR tile (`697_5329.tif`) and high-resolution
DOP20 aerial orthophoto of Skatepark "Im Gefilde" (UTM32 E=697975, N=5329860).
"""
import ssl
import urllib.request
import os

SSL_CTX = ssl._create_unverified_context()
OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "geodata"))
os.makedirs(OUT_DIR, exist_ok=True)

# 1. High-resolution DOP20 aerial orthophoto directly over Skatepark Im Gefilde (80m x 80m box)
# BBOX: E in [697935, 698015], N in [5329820, 5329900]
dop_closeup_url = (
    "https://geoservices.bayern.de/od/wms/dop/v1/dop20?"
    "SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=by_dop20c&STYLES=&"
    "SRS=EPSG:25832&BBOX=697935,5329820,698015,5329900&WIDTH=1024&HEIGHT=1024&FORMAT=image/png"
)
dop_closeup_path = os.path.join(OUT_DIR, "dop20_skatepark_closeup.png")
print("1. Downloading high-res DOP20 aerial orthophoto of Skatepark Im Gefilde (80m x 80m)...")
req = urllib.request.Request(dop_closeup_url, headers={"User-Agent": "SurfskateMunichGame/1.0"})
with urllib.request.urlopen(req, timeout=20, context=SSL_CTX) as resp:
    with open(dop_closeup_path, "wb") as f:
        f.write(resp.read())
print("   Saved", dop_closeup_path)

# 2. Download Bavarian OpenData DGM1 1m LiDAR GeoTIFF tile 697_5329.tif (where E=697975, N=5329860 lies!)
dgm_url = "https://download1.bayernwolke.de/a/dgm/dgm1/697_5329.tif"
dgm_path = os.path.join(OUT_DIR, "dgm1_697_5329.tif")
if not os.path.exists(dgm_path):
    print(f"2. Downloading Bavarian LDBV DGM1 LiDAR tile {dgm_url} ...")
    dreq = urllib.request.Request(dgm_url, headers={"User-Agent": "SurfskateMunichGame/1.0"})
    with urllib.request.urlopen(dreq, timeout=30, context=SSL_CTX) as resp:
        with open(dgm_path, "wb") as f:
            f.write(resp.read())
    print("   Saved", dgm_path)
else:
    print("2. DGM1 tile 697_5329.tif already exists.")
