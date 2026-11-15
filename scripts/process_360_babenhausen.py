#!/usr/bin/env python3
"""
scripts/process_360_babenhausen.py

Zerlegt ein 360°-Equirectangular-Video (z.B. Insta360 8K) von Babenhausen
in entzerrte Weitwinkel-Bilder (FOV 90°) und filtert Bewegungsunschärfe
mit OpenCV Laplacian, um die besten ~150-250 Bilder für Photogrammetrie
in `data/extracted_frames_babenhausen/` zu speichern.
"""

import os
import sys
import glob
import subprocess
import shutil
import cv2
import numpy as np

WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTPUT_DIR = os.path.join(WORKSPACE_DIR, "data", "extracted_frames_babenhausen")
TEMP_DIR = os.path.join(WORKSPACE_DIR, "data", "temp_raw_perspectives")


def find_babenhausen_video():
    candidates = []
    bbh_dir = os.path.join(WORKSPACE_DIR, "video", "bbh")
    if os.path.exists(bbh_dir):
        for f in os.listdir(bbh_dir):
            if f.lower().endswith((".mp4", ".mov", ".insv")):
                candidates.append(os.path.join(bbh_dir, f))

    if not candidates:
        for root, _, files in os.walk(os.path.join(WORKSPACE_DIR, "video")):
            for f in files:
                if "babenhausen" in f.lower() or "bbh" in f.lower():
                    if f.lower().endswith((".mp4", ".mov", ".insv")):
                        candidates.append(os.path.join(root, f))

    if not candidates:
        raise FileNotFoundError("Keine 360°-Videodatei von Babenhausen im Workspace gefunden!")

    candidates.sort(key=lambda p: os.path.getsize(p), reverse=True)
    return candidates[0]


def extract_perspectives(video_path):
    print(f"🎬 Gefundenes 360°-Video: {video_path}")
    print(f"   Dateigröße: {os.path.getsize(video_path) / (1024*1024*1024):.2f} GB")

    os.makedirs(TEMP_DIR, exist_ok=True)
    front_dir = os.path.join(TEMP_DIR, "front")
    right_dir = os.path.join(TEMP_DIR, "right")
    left_dir = os.path.join(TEMP_DIR, "left")

    for d in [front_dir, right_dir, left_dir]:
        os.makedirs(d, exist_ok=True)
        for old in glob.glob(os.path.join(d, "*.jpg")):
            os.remove(old)

    filter_complex = (
        "[0:v]fps=2,split=3[v0][v1][v2]; "
        "[v0]v360=e:rectilinear:yaw=0:pitch=-15:h_fov=90:v_fov=90:w=1920:h=1920[front]; "
        "[v1]v360=e:rectilinear:yaw=90:pitch=-15:h_fov=90:v_fov=90:w=1920:h=1920[right]; "
        "[v2]v360=e:rectilinear:yaw=-90:pitch=-15:h_fov=90:v_fov=90:w=1920:h=1920[left]"
    )

    cmd = [
        "ffmpeg", "-y",
        "-hwaccel", "videotoolbox",
        "-i", video_path,
        "-filter_complex", filter_complex,
        "-map", "[front]", "-qscale:v", "2", os.path.join(front_dir, "f_%05d.jpg"),
        "-map", "[right]", "-qscale:v", "2", os.path.join(right_dir, "r_%05d.jpg"),
        "-map", "[left]", "-qscale:v", "2", os.path.join(left_dir, "l_%05d.jpg"),
    ]

    print("🚀 Starte FFmpeg v360 Extraktion (2 FPS, Front/Right/Left FOV 90°)...")
    subprocess.check_call(cmd)
    print("✅ FFmpeg Extraktion abgeschlossen.")


def compute_sharpness(img_path):
    img = cv2.imread(img_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return 0.0
    return float(cv2.Laplacian(img, cv2.CV_64F).var())


def filter_and_select_frames():
    print("🔍 Analysiere Bildschärfe mit OpenCV cv2.Laplacian...")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for old in glob.glob(os.path.join(OUTPUT_DIR, "*.jpg")):
        os.remove(old)

    front_files = sorted(glob.glob(os.path.join(TEMP_DIR, "front", "*.jpg")))
    right_files = sorted(glob.glob(os.path.join(TEMP_DIR, "right", "*.jpg")))
    left_files = sorted(glob.glob(os.path.join(TEMP_DIR, "left", "*.jpg")))

    total_frames = len(front_files)
    print(f"   Extrahierte Zeitschritte: {total_frames} (insgesamt {total_frames * 3} Ansichten)")

    # Group into time bins to ensure uniform spatial coverage across the track
    # We want ~180-240 total images. With 3 camera directions, ~60-75 time bins.
    target_bins = min(70, total_frames)
    bin_size = max(1, total_frames // target_bins)

    selected = []
    all_scores = []

    for cam_name, file_list in [("front", front_files), ("right", right_files), ("left", left_files)]:
        for bin_idx in range(target_bins):
            start = bin_idx * bin_size
            end = min(total_frames, (bin_idx + 1) * bin_size) if bin_idx < target_bins - 1 else total_frames
            chunk = file_list[start:end]
            if not chunk:
                continue

            scored_chunk = []
            for path in chunk:
                score = compute_sharpness(path)
                scored_chunk.append((score, path))
                all_scores.append(score)

            scored_chunk.sort(key=lambda x: x[0], reverse=True)
            best_score, best_path = scored_chunk[0]
            # Minimum sharpness threshold to eliminate heavy motion blur
            if best_score > 30.0:
                selected.append((best_score, best_path, cam_name))

    print(f"   Schärfe-Statistik: Min={min(all_scores):.1f}, Median={np.median(all_scores):.1f}, Max={max(all_scores):.1f}")
    print(f"   Kandidaten nach Schärfefilterung: {len(selected)}")

    # Sort selected frames chronologically for sequential tracking
    selected.sort(key=lambda x: os.path.basename(x[1]))

    # Target between 150 and 250 images
    if len(selected) > 250:
        step = len(selected) / 220.0
        indices = [int(i * step) for i in range(220)]
        final_list = [selected[i] for i in indices]
    else:
        final_list = selected

    print(f"💾 Kopiere {len(final_list)} finale Bilder nach {OUTPUT_DIR}...")
    for idx, (score, src_path, cam) in enumerate(final_list):
        dst_name = f"frame_{idx:04d}_{cam}.jpg"
        dst_path = os.path.join(OUTPUT_DIR, dst_name)
        shutil.copy2(src_path, dst_path)

    print(f"🎉 Fertig! {len(final_list)} hochauflösende, scharfe Bilder bereit in:")
    print(f"   {OUTPUT_DIR}")

    # Clean up temp raw frames
    try:
        shutil.rmtree(TEMP_DIR)
        print("🧹 Temporäre Rohbilder aufgeräumt.")
    except Exception as e:
        print(f"Hinweis beim Aufräumen: {e}")


def main():
    video = find_babenhausen_video()
    extract_perspectives(video)
    filter_and_select_frames()


if __name__ == "__main__":
    main()
