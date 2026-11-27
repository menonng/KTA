"""Download the CC0 source textures listed in textures.json from Poly Haven
and convert them to raw RGBA slices for the KTX2 encoder.

Usage: python3 fetch_textures.py <work_dir>
Writes <work_dir>/<id>_{diff,nor}.rgba plus a manifest.json.
"""
import json, os, subprocess, sys
from io import BytesIO
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "kta-asset-pipeline/0.1"
SIZES = {"diff": 1024, "nor": 512}


def get(url):
    return subprocess.run(["curl", "-sSfL", "-A", UA, url], check=True, capture_output=True).stdout


def main():
    work = sys.argv[1]
    os.makedirs(work, exist_ok=True)
    spec = json.load(open(os.path.join(HERE, "textures.json")))
    manifest = {}
    for arr, a in spec["arrays"].items():
        for layer in a["layers"]:
            tid = layer["id"]
            files = json.loads(get(f"https://api.polyhaven.com/files/{tid}"))
            for kind, key in (("diff", "Diffuse"), ("nor", "nor_gl")):
                src = files[key]["1k"]["jpg"]["url"]
                img = Image.open(BytesIO(get(src))).convert("RGBA")
                s = SIZES[kind]
                if img.size != (s, s):
                    img = img.resize((s, s), Image.LANCZOS)
                out = os.path.join(work, f"{tid}_{kind}.rgba")
                open(out, "wb").write(img.tobytes())
                manifest[f"{tid}_{kind}"] = {"w": s, "h": s, "src": src}
            print("ok", tid, flush=True)
    json.dump(manifest, open(os.path.join(work, "manifest.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
