"""Image helper for build_people.mjs (run with python3 -I).

  img.py load <in.tga|png> <out.raw> <w> <h>   -> RGBA 8-bit raw, top row first, resized to w x h
Prints "w h" on stdout.
"""
import sys
from PIL import Image


def main():
    cmd = sys.argv[1]
    if cmd == 'load':
        src, dst, w, h = sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
        im = Image.open(src).convert('RGBA')
        if im.size != (w, h):
            im = im.resize((w, h), Image.LANCZOS)
        with open(dst, 'wb') as f:
            f.write(im.tobytes())
        print(w, h)
    else:
        raise SystemExit('unknown command ' + cmd)


main()
