"""Download the CC0 glTF models listed in models.json from Poly Haven (1k)
and resize their textures to raw RGBA for the KTX2 encoder.

Usage: python3 fetch_models.py <work_dir>
Writes <work_dir>/<name>/<id>.gltf (+ .bin) and <work_dir>/<name>/tex/<file>.rgba
plus <work_dir>/<name>/textures.json (file -> w, h).
"""
import json, os, subprocess, sys
from io import BytesIO
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "kta-asset-pipeline/0.1"


def get(url):
    return subprocess.run(["curl", "-sSfL", "-A", UA, url], check=True, capture_output=True).stdout


def main():
    work = sys.argv[1]
    spec = json.load(open(os.path.join(HERE, "models.json")))
    for name, m in spec["models"].items():
        out = os.path.join(work, name)
        os.makedirs(os.path.join(out, "tex"), exist_ok=True)
        files = json.loads(get(f"https://api.polyhaven.com/files/{m['id']}"))
        g = files["gltf"]["1k"]["gltf"]
        gltf_path = os.path.join(out, f"{m['id']}.gltf")
        open(gltf_path, "wb").write(get(g["url"]))
        gltf = json.load(open(gltf_path))
        used = {img["uri"] for img in gltf.get("images", [])}
        texinfo = {}
        for rel, inc in g["include"].items():
            data = get(inc["url"])
            if rel.endswith(".bin"):
                os.makedirs(os.path.dirname(os.path.join(out, rel)) or out, exist_ok=True)
                open(os.path.join(out, rel), "wb").write(data)
                continue
            if rel not in used:
                continue
            img = Image.open(BytesIO(data))
            mode = "RGBA" if img.mode in ("RGBA", "LA") else "RGB"
            img = img.convert(mode).resize((m["tex"], m["tex"]), Image.LANCZOS).convert("RGBA")
            key = os.path.basename(rel)
            open(os.path.join(out, "tex", key + ".rgba"), "wb").write(img.tobytes())
            texinfo[rel] = {"w": m["tex"], "h": m["tex"], "file": key + ".rgba"}
        json.dump(texinfo, open(os.path.join(out, "textures.json"), "w"), indent=1)
        print("ok", name, m["id"], len(texinfo), "textures", flush=True)


if __name__ == "__main__":
    main()
