#!/usr/bin/env python3
"""Render footer-samples.json to PNG images.

Each key becomes one PNG strip.  Theme backgrounds:
  dark  themes → #262320
  light themes → #F5EFE4
Font: JetBrains Mono Nerd Font Mono Regular/Bold, 14px.
Handles truecolor SGR: fg (38;2;r;g;b), bg (48;2;r;g;b), bold (1), reset (0/39/49/22).

Usage:
  python3 render-footer-png.py [samples.json [out_dir]]

Environment overrides:
  FOOTER_SAMPLES   path to samples JSON (overrides argv[1])
  WARM_UI_FONT_DIR path to JetBrains Mono Nerd font directory
"""
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# --- paths (portable, no hardcoded username) ---
_default_samples = os.path.join(tempfile.gettempdir(), "footer-samples.json")
SAMPLES = os.environ.get("FOOTER_SAMPLES") or (sys.argv[1] if len(sys.argv) > 1 else _default_samples)
_default_out = tempfile.gettempdir()
OUT_DIR = sys.argv[2] if len(sys.argv) > 2 else _default_out

_default_font_dir = Path.home() / ".local" / "share" / "fonts" / "JetBrainsMonoNerd"
FONT_DIR = os.environ.get("WARM_UI_FONT_DIR") or str(_default_font_dir)
FONT_REG = os.path.join(FONT_DIR, "JetBrainsMonoNerdFontMono-Regular.ttf")
FONT_BOLD = os.path.join(FONT_DIR, "JetBrainsMonoNerdFontMono-Bold.ttf")

CELL_H = 22   # px per line
WATERMARK_H = 22  # independent top row for watermark text
FONT_SIZE = 14
PADDING_X = 6
PADDING_Y = 4

DARK_BG  = (0x26, 0x23, 0x20)
LIGHT_BG = (0xF5, 0xEF, 0xE4)
# Default FG: terminal actual dark/light values
DARK_FG  = (0xD3, 0xCB, 0xBF)
LIGHT_FG = (0x3B, 0x35, 0x2E)

os.makedirs(OUT_DIR, exist_ok=True)

font_reg  = ImageFont.truetype(FONT_REG,  FONT_SIZE)
font_bold = ImageFont.truetype(FONT_BOLD, FONT_SIZE)

# Measure cell width from font
_bbox = font_reg.getbbox("M")
CELL_W = _bbox[2] - _bbox[0]

def parse_ansi(line: str):
    """Parse ANSI SGR sequences, yield (text, fg_rgb, bg_rgb, bold) spans."""
    SGR_RE = re.compile(r'\x1b\[([0-9;]*)m')
    spans = []
    fg = None
    bg = None
    bold = False
    pos = 0
    for m in SGR_RE.finditer(line):
        # text before this escape
        if m.start() > pos:
            spans.append((line[pos:m.start()], fg, bg, bold))
        # parse codes
        codes_raw = m.group(1)
        codes = [int(c) if c else 0 for c in codes_raw.split(';')] if codes_raw else [0]
        i = 0
        while i < len(codes):
            c = codes[i]
            if c == 0:
                fg = bg = None; bold = False
            elif c == 1:
                bold = True
            elif c == 22:
                bold = False
            elif c == 39:
                fg = None
            elif c == 49:
                bg = None
            elif c == 38 and i+1 < len(codes) and codes[i+1] == 2:
                if i+4 <= len(codes) - 1:
                    fg = (codes[i+2], codes[i+3], codes[i+4]); i += 4
            elif c == 48 and i+1 < len(codes) and codes[i+1] == 2:
                if i+4 <= len(codes) - 1:
                    bg = (codes[i+2], codes[i+3], codes[i+4]); i += 4
            i += 1
        pos = m.end()
    if pos < len(line):
        spans.append((line[pos:], fg, bg, bold))
    return spans


def render_line(draw, x0, y0, spans, default_fg, default_bg):
    x = x0
    for text, fg, bg, bold in spans:
        if not text:
            continue
        fnt = font_bold if bold else font_reg
        # character-by-character to handle wide chars
        for ch in text:
            # estimate cell count: CJK/emoji = 2, else 1
            cp = ord(ch)
            wide = (
                0x1100 <= cp <= 0x115F or
                0x2E80 <= cp <= 0x303E or
                0x3041 <= cp <= 0x33BF or
                0x3400 <= cp <= 0x4DBF or
                0x4E00 <= cp <= 0xA4CF or
                0xA960 <= cp <= 0xA97F or
                0xAC00 <= cp <= 0xD7FF or
                0xF900 <= cp <= 0xFAFF or
                0xFE10 <= cp <= 0xFE1F or
                0xFE30 <= cp <= 0xFE6F or
                0xFF01 <= cp <= 0xFF60 or
                0xFFE0 <= cp <= 0xFFE6 or
                0x1F300 <= cp <= 0x1FAFF
            )
            cw = CELL_W * (2 if wide else 1)
            actual_bg = bg if bg else default_bg
            draw.rectangle([x, y0, x + cw - 1, y0 + CELL_H - 1], fill=actual_bg)
            actual_fg = fg if fg else default_fg
            draw.text((x, y0 + 2), ch, font=fnt, fill=actual_fg)
            x += cw
    return x


with open(SAMPLES) as f:
    samples = json.load(f)

print(f"Rendering {len(samples)} samples to {OUT_DIR}/")

for key, lines in samples.items():
    # determine dark/light from theme name
    is_light = "light" in key.split("|")[0]
    term_bg = LIGHT_BG if is_light else DARK_BG
    term_fg = LIGHT_FG if is_light else DARK_FG

    # width from key e.g. "....|w120"
    width_part = [p for p in key.split("|") if p.startswith("w")]
    cols = int(width_part[0][1:]) if width_part else 120
    img_w = cols * CELL_W + PADDING_X * 2
    # watermark occupies an independent top row of WATERMARK_H px; footer rows start below it
    img_h = WATERMARK_H + len(lines) * CELL_H + PADDING_Y * 2

    img = Image.new("RGB", (img_w, img_h), term_bg)
    draw = ImageDraw.Draw(img)

    # watermark: independent top 22 px row, use term_fg so it blends with the theme
    draw.text((2, 3), "synthetic fixture", font=font_reg, fill=term_fg)

    for li, line in enumerate(lines):
        if not isinstance(line, str):
            continue
        # footer rows start after the watermark row
        y = WATERMARK_H + PADDING_Y + li * CELL_H
        spans = parse_ansi(line)
        render_line(draw, PADDING_X, y, spans, term_fg, term_bg)

    safe_key = key.replace("|", "_").replace("/", "-").replace(" ", "-")
    out_path = os.path.join(OUT_DIR, f"{safe_key}.png")
    img.save(out_path)
    print(f"  wrote {out_path}")

print("Done.")
