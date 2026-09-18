"""Build all Prior brand assets from the V1 Apex mark.

Reads:  public/branding/v1-apex.svg  (obsidian+coral, light backgrounds)
        public/branding/v1-apex-light.svg (cream+coral, dark backgrounds)
Writes: canonical marks, lockups, favicons, mac app icon, Tauri icon set,
        Windows tiles, site assets, and a preview contact sheet.
Requires: cairosvg, Pillow (macOS iconutil for .icns).
"""
from pathlib import Path
import io
import re
import shutil
import subprocess

import cairosvg
from PIL import Image, ImageDraw

APP = Path(__file__).resolve().parents[2]          # app/
PUBLIC = APP / "public"
BRAND = PUBLIC / "branding"
TAURI_ICONS = APP / "src-tauri" / "icons"
REPO = APP.parent
SITE = REPO / "site"

TILE = 1024  # mac app icon canvas


def nid(svg: str, prefix: str) -> str:
    """Prefix gradient/filter ids so composites never collide."""
    ids = re.findall(r'id="([^"]+)"', svg)
    out = svg
    for old in sorted(ids, key=len, reverse=True):
        out = out.replace(f'#{old}', f'#{prefix}-{old}').replace(f'id="{old}"', f'id="{prefix}-{old}"')
    return out


def inner(svg_text: str) -> str:
    """Return the inner content of an <svg> (strip outer tag)."""
    m = re.search(r"<svg[^>]*>(.*)</svg>", svg_text, re.S)
    assert m, "bad svg"
    return m.group(1)


def png_bytes(svg_text: str, w: int, h: int | None = None) -> bytes:
    if h is None:
        return cairosvg.svg2png(bytestring=svg_text.encode(), output_width=w)
    return cairosvg.svg2png(bytestring=svg_text.encode(), output_width=w, output_height=h)


def write_png(svg_text: str, path: Path, w: int, h: int | None = None) -> None:
    data = png_bytes(svg_text, w, h)
    path.write_bytes(data)
    print(f"  png {w}x{h or '?'}  {path.relative_to(REPO)}")


MARK = (BRAND / "v1-apex.svg").read_text()
MARK_LIGHT = (BRAND / "v1-apex-light.svg").read_text()

WHITE_MARK = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none">
  <defs>
    <linearGradient id="agent-white" x1="80" y1="30" x2="190" y2="226" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" />
      <stop offset=".65" stop-color="#fdf3e9" />
      <stop offset="1" stop-color="#f3ddd0" />
    </linearGradient>
  </defs>
  <path d="M80 48 H132 C166 48 188 70 188 104 C188 138 166 160 132 160 H80" stroke="url(#agent-white)" stroke-width="36" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M80 48 V198" stroke="url(#agent-white)" stroke-width="36" stroke-linecap="round" />
  <path d="M80 196 V208" stroke="#ffffff" stroke-width="36" stroke-linecap="round" />
</svg>"""

FAVICON_SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <defs>
    <linearGradient id="fav-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff7b62" />
      <stop offset=".55" stop-color="#fa654a" />
      <stop offset="1" stop-color="#cf3c22" />
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#fav-bg)" />
  <svg x="7" y="7" width="50" height="50" viewBox="0 0 256 256">{inner(nid(WHITE_MARK, "fav"))}</svg>
</svg>"""

APP_ICON_SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none">
  <defs>
    <linearGradient id="mac-bg" x1="512" y1="100" x2="512" y2="924" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#2e2825" />
      <stop offset="1" stop-color="#100e0d" />
    </linearGradient>
    <linearGradient id="mac-rim" x1="512" y1="100" x2="512" y2="924" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".26" />
      <stop offset=".5" stop-color="#ffffff" stop-opacity=".05" />
      <stop offset="1" stop-color="#000000" stop-opacity=".42" />
    </linearGradient>
    <linearGradient id="mac-sheen" x1="512" y1="100" x2="512" y2="500" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".09" />
      <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
    </linearGradient>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#mac-bg)" />
  <rect x="100" y="100" width="824" height="500" rx="185" fill="url(#mac-sheen)" />
  <rect x="100.5" y="100.5" width="823" height="823" rx="184.5" stroke="url(#mac-rim)" stroke-width="2" />
  <svg x="177" y="192" width="640" height="640" viewBox="0 0 256 256">{inner(nid(MARK_LIGHT, "mac"))}</svg>
</svg>"""


def lockup(mark: str, text_fill: str, prefix: str) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 512" fill="none">
  <svg x="40" y="56" width="400" height="400" viewBox="0 0 256 256">{inner(nid(mark, prefix))}</svg>
  <text x="505" y="332" font-family="DM Sans, Inter, -apple-system, 'Segoe UI', sans-serif" font-size="218" font-weight="700" letter-spacing="-9" fill="{text_fill}">Prior</text>
</svg>"""


LOCKUP_SVG = lockup(MARK, "#1d1917", "lock")
LOCKUP_LIGHT_SVG = lockup(MARK_LIGHT, "#f6efe6", "lockl")


def main() -> None:
    print("marks")
    (PUBLIC / "prior-logo.svg").write_text(MARK)
    (PUBLIC / "prior-logo-light.svg").write_text(MARK_LIGHT)
    write_png(MARK, PUBLIC / "prior-logo.png", 1024)
    write_png(MARK_LIGHT, PUBLIC / "prior-logo-light.png", 1024)
    (BRAND / "prior-agent-mark-white.svg").write_text(WHITE_MARK)

    print("lockups")
    (PUBLIC / "prior-lockup.svg").write_text(LOCKUP_SVG)
    (PUBLIC / "prior-lockup-light.svg").write_text(LOCKUP_LIGHT_SVG)
    write_png(LOCKUP_SVG, PUBLIC / "prior-lockup.png", 1600)
    write_png(LOCKUP_LIGHT_SVG, PUBLIC / "prior-lockup-light.png", 1600)

    print("favicons")
    (PUBLIC / "favicon.svg").write_text(FAVICON_SVG)
    write_png(FAVICON_SVG, PUBLIC / "favicon.png", 64)
    write_png(FAVICON_SVG, PUBLIC / "favicon-48.png", 48)
    fav = Image.open(io.BytesIO(png_bytes(FAVICON_SVG, 256))).convert("RGBA")
    fav.save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"  ico multi-size  {PUBLIC.relative_to(REPO)}/favicon.ico")

    print("mac app icon")
    (PUBLIC / "prior-app-icon.svg").write_text(APP_ICON_SVG)
    write_png(APP_ICON_SVG, PUBLIC / "prior-app-icon.png", 1024)

    print("tauri icons")
    write_png(APP_ICON_SVG, TAURI_ICONS / "icon.png", 1024)
    write_png(APP_ICON_SVG, TAURI_ICONS / "32x32.png", 32)
    write_png(APP_ICON_SVG, TAURI_ICONS / "64x64.png", 64)
    write_png(APP_ICON_SVG, TAURI_ICONS / "128x128.png", 128)
    write_png(APP_ICON_SVG, TAURI_ICONS / "128x128@2x.png", 256)
    icon = Image.open(io.BytesIO(png_bytes(APP_ICON_SVG, 256))).convert("RGBA")
    icon.save(TAURI_ICONS / "icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("  ico multi-size  src-tauri/icons/icon.ico")

    print("windows tiles")
    for size in (30, 44, 71, 89, 107, 142, 150, 284, 310):
        write_png(APP_ICON_SVG, TAURI_ICONS / f"Square{size}x{size}Logo.png", size)
    write_png(APP_ICON_SVG, TAURI_ICONS / "StoreLogo.png", 50)

    print("icns")
    iconset = Path("/tmp/Prior.iconset")
    shutil.rmtree(iconset, ignore_errors=True)
    iconset.mkdir(parents=True)
    for name, px in (("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32),
                     ("icon_32x32@2x", 64), ("icon_128x128", 128), ("icon_128x128@2x", 256),
                     ("icon_256x256", 256), ("icon_256x256@2x", 512),
                     ("icon_512x512", 512), ("icon_512x512@2x", 1024)):
        (iconset / f"{name}.png").write_bytes(png_bytes(APP_ICON_SVG, px))
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(TAURI_ICONS / "icon.icns")],
                   check=True)
    print("  icns  src-tauri/icons/icon.icns")

    print("site")
    (SITE / "prior-logo.svg").write_text(MARK_LIGHT)
    write_png(MARK_LIGHT, SITE / "prior-logo.png", 1024)
    (SITE / "prior-lockup.svg").write_text(LOCKUP_LIGHT_SVG)
    (SITE / "prior-lockup.png").write_bytes((PUBLIC / "prior-lockup-light.png").read_bytes())
    (SITE / "favicon.svg").write_text(FAVICON_SVG)
    (SITE / "favicon.png").write_bytes((PUBLIC / "favicon.png").read_bytes())
    (SITE / "favicon.ico").write_bytes((PUBLIC / "favicon.ico").read_bytes())
    for name in ("v1-apex.svg", "v1-apex-light.svg", "v2-fold.svg", "v2-fold-light.svg",
                 "v3-pulse.svg", "v3-pulse-light.svg"):
        (SITE / "branding" / name).write_bytes((BRAND / name).read_bytes())
    print("  site assets updated (+ branding concepts mirrored)")

    print("preview")
    preview()

    # legacy android reference expects a mark png; refresh it from the app icon
    android_mark = TAURI_ICONS / "prior-mark.png"
    if android_mark.exists():
        write_png(APP_ICON_SVG, android_mark, 512)


def preview() -> None:
    """Contact sheet: concepts, lockups, app icon, favicon sizes, agent mock."""
    def r(svg: str, size: int) -> Image.Image:
        return Image.open(io.BytesIO(png_bytes(svg, size))).convert("RGBA")

    W, light, dark = 280, (247, 247, 245, 255), (32, 32, 31, 255)
    rows: list[tuple[str, Image.Image, tuple]] = []
    for key, label in (("v1-apex", "V1 Apex (new logo)"), ("v2-fold", "V2 Fold (alt)"), ("v3-pulse", "V3 Pulse (alt)")):
        rows.append((label, r((BRAND / f"{key}.svg").read_text(), 240), light))
        rows.append((label + " on dark", r((BRAND / f"{key}-light.svg").read_text(), 240), dark))
    rows.append(("Lockup", r(LOCKUP_SVG, 520), light))
    rows.append(("Lockup on dark", r(LOCKUP_LIGHT_SVG, 520), dark))
    rows.append(("Mac app icon", r(APP_ICON_SVG, 240), dark))
    rows.append(("Favicon 48 / 32 / 16", r(FAVICON_SVG, 240), light))
    # agent mock: orange fluid-ish gradient + white mark
    agent = Image.new("RGBA", (240, 240), (0, 0, 0, 0))
    grad = Image.new("RGBA", (240, 240))
    dp = ImageDraw.Draw(grad)
    for y in range(240):
        t = y / 239
        dp.line([(0, y), (240, y)],
                fill=(int(250 - 60 * t), int(110 - 40 * t), int(90 - 45 * t), 255))
    mask = Image.new("L", (240, 240), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, 240, 240], radius=72, fill=255)
    agent.paste(Image.composite(grad, Image.new("RGBA", (240, 240), (214, 63, 37, 255)), mask), (0, 0))
    agent.alpha_composite(r(WHITE_MARK, 240))
    rows.append(("Agent mock (shader+white)", agent, dark))

    sheet = Image.new("RGB", (W * 3, 340 * ((len(rows) + 2) // 3)), (18, 18, 18))
    d = ImageDraw.Draw(sheet)
    for i, (label, img, bg) in enumerate(rows):
        x, y = (i % 3) * W, (i // 3) * 340
        tile = Image.new("RGBA", (240, 240), bg)
        if img.size[0] > 240:  # wide lockup: fit width
            w = 240
            h = round(img.size[1] * 240 / img.size[0])
            img = img.resize((w, h))
        tile.alpha_composite(img, ((240 - img.size[0]) // 2, (240 - img.size[1]) // 2))
        sheet.paste(tile.convert("RGB"), (x + 20, y + 20))
        d.text((x + 20, y + 272), label, fill=(255, 255, 255))
    out = BRAND / "preview.png"
    sheet.save(out)
    print(f"  contact sheet  {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
