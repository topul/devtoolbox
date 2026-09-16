#!/usr/bin/env python3
"""Generate the application icon (build/icon.png + build/icon.ico).

The mark is the app's own visual language: a phosphor-green terminal prompt
(chevron + cursor bar) on the dark panel background, matching the palette in
src/index.css (--c-phosphor / --c-panel).

Re-run this whenever the palette or the mark changes:

    python3 scripts/gen-icon.py

Requires Pillow. Outputs a 1024x1024 PNG (source of truth for electron-builder,
which derives the macOS .icns from it) plus a multi-resolution .ico so the
Windows MSI target always has a real icon file to link against.

The .ico entries are written as uncompressed DIB rather than PNG on purpose:
the Windows Installer Icon table (which WiX fills for the msi target) does not
accept PNG-compressed icon entries.
"""

from PIL import Image, ImageDraw

SIZE = 1024
SS = 4                                  # supersample factor, downscaled at the end
S = SIZE * SS

PHOSPHOR = (0, 244, 142, 255)
BORDER = (0, 244, 142, 46)
BG_TOP = (14, 28, 20, 255)
BG_BOTTOM = (3, 7, 5, 255)

PAD = 44
RADIUS = 224


def sc(v: float) -> float:
    """Scale a coordinate from the 1024 design space to the working canvas."""
    return v * SS


def gradient(size: int) -> Image.Image:
    grad = Image.new('RGBA', (size, size))
    draw = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / (size - 1)
        draw.line(
            [(0, y), (size, y)],
            fill=tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)) + (255,),
        )
    return grad


def capsule(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], width: int) -> None:
    """Draw a polyline with round caps and round joins."""
    pts = [(sc(x), sc(y)) for x, y in points]
    draw.line(pts, fill=PHOSPHOR, width=width, joint='curve')
    for x, y in pts:
        r = width / 2
        draw.ellipse([x - r, y - r, x + r, y + r], fill=PHOSPHOR)


def main() -> None:
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    # Rounded-square panel with a soft vertical gradient.
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [sc(PAD), sc(PAD), S - sc(PAD), S - sc(PAD)], radius=sc(RADIUS), fill=255
    )
    img.paste(gradient(S), (0, 0), mask)

    draw = ImageDraw.Draw(img)

    # Hairline phosphor border for definition on dark backgrounds.
    inset = 16
    draw.rounded_rectangle(
        [sc(PAD + inset), sc(PAD + inset), S - sc(PAD + inset), S - sc(PAD + inset)],
        radius=sc(RADIUS - inset),
        outline=BORDER,
        width=sc(6),
    )

    stroke = sc(100)

    # Chevron ">" and the cursor bar "_" of the terminal prompt.
    capsule(draw, [(318, 352), (478, 512), (318, 672)], stroke)
    capsule(draw, [(536, 672), (716, 672)], stroke)

    img = img.resize((SIZE, SIZE), Image.LANCZOS)

    png_path = 'build/icon.png'
    ico_path = 'build/icon.ico'
    img.save(png_path)
    img.save(ico_path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
             bitmap_format='bmp')
    print(f'wrote {png_path} ({SIZE}x{SIZE}) and {ico_path} (16-256px)')


if __name__ == '__main__':
    main()
