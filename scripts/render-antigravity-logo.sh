#!/usr/bin/env bash
#
# Render the Antigravity Marketplace logo (assets/antigravity-logo.png).
#
# Usage:
#   scripts/render-antigravity-logo.sh [--output PATH]
#
# Draws the nested-hexagon mark from assets/banner.svg (indigo #818cf8 strokes)
# on the banner's dark gradient, as a 512x512 RGBA rounded square with
# transparent corners. Pure python3 stdlib (zlib + struct) — no rsvg/PIL — and
# deterministic, so a re-render is byte-identical to the committed PNG.
# Adapted from upstream superpowers' rsvg-based script of the same name.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT="$REPO_ROOT/assets/antigravity-logo.png"

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
}

die() {
  echo "error: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      [[ $# -ge 2 ]] || die "--output needs a path"
      OUTPUT="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
done

command -v python3 >/dev/null 2>&1 || die "python3 is not on PATH"

python3 -I - "$OUTPUT" <<'PY'
import math
import struct
import sys
import zlib

SIZE = 512
# Rounded square: x/y 31..481, corner radius 100 (upstream's frame geometry).
SQ_MIN, SQ_MAX, RADIUS = 31.0, 481.0, 100.0
BG_FROM, BG_TO = (0x0F, 0x17, 0x2A), (0x1E, 0x1B, 0x4B)  # banner gradient
STROKE = (0x81, 0x8C, 0xF8)                              # banner accent
# banner.svg's mark: two hexagons in a 120x140 box centred on (60,70).
OUTER = [(60, 0), (120, 35), (120, 105), (60, 140), (0, 105), (0, 35)]
INNER = [(60, 30), (90, 47), (90, 93), (60, 110), (30, 93), (30, 47)]
SCALE = 2.2                     # mark ~308px tall, ~70% of the square
HALF_WIDTH = 5 * SCALE / 2      # banner stroke-width 5, scaled


def place(points):
    return [((x - 60) * SCALE + 256, (y - 70) * SCALE + 256) for x, y in points]


SEGMENTS = []
for poly in (place(OUTER), place(INNER)):
    SEGMENTS += [(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))]
XS = [p[0] for s in SEGMENTS for p in s]
YS = [p[1] for s in SEGMENTS for p in s]
BBOX = (min(XS) - HALF_WIDTH - 2, max(XS) + HALF_WIDTH + 2,
        min(YS) - HALF_WIDTH - 2, max(YS) + HALF_WIDTH + 2)


def seg_dist(px, py, a, b):
    (ax, ay), (bx, by) = a, b
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def square_coverage(px, py):
    # Signed distance to the rounded square, 1px linear anti-aliasing.
    cx = min(max(px, SQ_MIN + RADIUS), SQ_MAX - RADIUS)
    cy = min(max(py, SQ_MIN + RADIUS), SQ_MAX - RADIUS)
    d = math.hypot(px - cx, py - cy) - RADIUS
    return min(1.0, max(0.0, 0.5 - d))


def stroke_coverage(px, py):
    if not (BBOX[0] <= px <= BBOX[1] and BBOX[2] <= py <= BBOX[3]):
        return 0.0
    d = min(seg_dist(px, py, a, b) for a, b in SEGMENTS)
    return min(1.0, max(0.0, HALF_WIDTH + 0.5 - d))


rows = []
for y in range(SIZE):
    row = bytearray(b"\x00")  # PNG filter type 0
    for x in range(SIZE):
        px, py = x + 0.5, y + 0.5
        alpha = square_coverage(px, py)
        if alpha == 0.0:
            row += b"\x00\x00\x00\x00"
            continue
        t = min(1.0, max(0.0, (px + py) / (2 * SIZE)))
        bg = [f + (to - f) * t for f, to in zip(BG_FROM, BG_TO)]
        s = stroke_coverage(px, py)
        rgb = [round(c * (1 - s) + k * s) for c, k in zip(bg, STROKE)]
        row += bytes(rgb) + bytes([round(alpha * 255)])
    rows.append(bytes(row))


def chunk(kind, data):
    return (struct.pack(">I", len(data)) + kind + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))


png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
       + chunk(b"IEND", b""))
with open(sys.argv[1], "wb") as fh:
    fh.write(png)
PY
echo "wrote $OUTPUT"
