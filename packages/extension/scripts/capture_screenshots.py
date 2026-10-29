"""Render scripts/ExtensionTemplate.html to PNGs at several sizes using headless Chrome/Edge.

Usage (from packages/extension): python scripts/capture_screenshots.py
Output: scripts/SmartSearch_<W>x<H>.png (next to this file, outside public/ so they are not bundled into the extension)

Needs no extra installs. The card is stretched to fill each canvas and its content is
zoomed to fit (min of width/height ratio against the card's natural 427x285 size), so
very wide canvases such as 1400x560 have empty side margins. Canvases of 128px or less
render the logo only, since text would be illegible.
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "ExtensionTemplate.html")
OUT_DIR = HERE
NAME = "SmartSearch"
LOGO_ONLY_MAX = 128
SIZES = [(440, 280), (1400, 560), (64, 64), (128, 128), (512, 512), (640, 400)]
CARD_W, CARD_H = 427, 285

BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def find_browser():
    for name in ("chrome", "msedge", "google-chrome", "chromium"):
        p = shutil.which(name)
        if p:
            return p
    for p in BROWSERS:
        if os.path.exists(p):
            return p
    sys.exit("No Chrome/Edge found; install one or add it to BROWSERS.")


def override_css(w, h):
    if max(w, h) <= LOGO_ONLY_MAX:
        d = round(min(w, h) * 0.78)
        return f"""<style>
html,body{{width:{w}px;height:{h}px;margin:0;padding:0;overflow:hidden}}
body{{display:flex;align-items:center;justify-content:center}}
.card{{max-width:none;width:{w}px;height:{h}px;min-height:0;aspect-ratio:auto;
  border-radius:0;box-shadow:none;padding:0}}
.card>:not(.logo){{display:none}}
.brand{{display:none}}
.icon{{width:{d}px;height:{d}px;box-shadow:0 0 {d // 4}px rgba(59,130,214,.45)}}
</style>"""
    z = min(w / CARD_W, h / CARD_H)
    return f"""<style>
html,body{{width:{w}px;height:{h}px;margin:0;padding:0;overflow:hidden}}
body{{display:block}}
.card{{max-width:none;width:{w}px;height:{h}px;min-height:0;aspect-ratio:auto;
  border-radius:0;box-shadow:none;padding:0}}
.card>:not(.dot){{zoom:{z}}}
.dot{{transform:scale({z})}}
</style>"""


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    browser = find_browser()
    with open(SRC, encoding="utf-8") as f:
        html = f.read()

    for w, h in SIZES:
        # Temp page lives next to the source so its relative icon path still resolves.
        fd, tmp = tempfile.mkstemp(suffix=".html", prefix="_shot_", dir=HERE)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(html.replace("</head>", override_css(w, h) + "</head>"))
        out = os.path.join(OUT_DIR, f"{NAME}_{w}x{h}.png")
        try:
            subprocess.run(
                [browser, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                 "--force-device-scale-factor=1", f"--window-size={w},{h}",
                 f"--screenshot={out}", "file:///" + tmp.replace("\\", "/")],
                check=True, capture_output=True, timeout=60,
            )
        finally:
            os.remove(tmp)
        print("wrote", out)


if __name__ == "__main__":
    main()
