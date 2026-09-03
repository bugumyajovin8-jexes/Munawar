#!/usr/bin/env python3
"""
Builds every app icon from the Munawar logo.  python scripts/make-icons.py

Not part of the build and not in package.json — it runs once, by hand, when the
logo changes. It needs Pillow, which the app does not otherwise depend on; the
files it writes are committed, so nobody needs this installed to build or ship.

The source is a *mockup*: the icon artwork sits as a rounded square in the
middle of a black field with a soft glow around it. Shipping that whole image
would put the mockup's background into the launcher, so the square is located
by its edges and cut out. The crop below was measured by summed image gradient
— the glow is smooth and contributes almost none, while the icon's edge is a
step — and is hard-coded rather than re-measured on every run so that a change
to the artwork cannot silently shift the crop without anybody noticing.
"""

from PIL import Image, ImageDraw
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "Munawar.png"

# Measured: sharp vertical edges at x≈305 and x≈1253, horizontal at y≈31 and
# y≈979 — 948 square, to the pixel.
CROP = (305, 31, 305 + 948, 31 + 948)

"""
Pixels shaved off every side of that crop.

The mockup's glow sits immediately outside the icon and the edge between them
is one or two pixels wide, so a crop that is even slightly generous carries a
hair of it. Cut out and dropped on flat navy it reads as a pale halo tracing
the artwork — subtle in isolation, obvious once the icon is on a home screen
next to everything else.
"""
TRIM = 3

"""
The corner radius, as a fraction of the side.

22.37% is the proportion Apple's icon grid uses and the one this artwork was
drawn to. It is not measured from the image: the gold swooshes run right into
two of the corners, so there is no reliable navy-versus-background edge to
read there. Compositing onto the logo's own navy first means a pixel or two of
error lands on matching colour rather than on a sliver of the mockup's black.
"""
RADIUS = 0.2237

"""
The favicon's crop, as centre-x, centre-y and side — fractions of the icon.

A mild zoom rather than an attempt to lift the M out on its own. Measuring it
as a connected blob of gold puts the letter and its flourish across 81% of the
icon's width, so any crop tight enough to be called a mark clips the letter,
and every tighter framing tried did. This keeps the M whole and centred and
lets the wordmark fall away to a base line, which is what makes the difference
at sixteen pixels — where the full logo is a smear, the script being finer
than a pixel and turning to grey speckle.

Fitted by eye against renders at 16, 32 and 48, because whether it reads is
the only question this file has to answer.
"""
MARK = (0.51, 0.40, 0.80)


def body_colour(icon: Image.Image) -> tuple[int, int, int]:
    """
    The logo's own dark navy, taken from the artwork rather than typed in.

    The median of the darker half of the interior: the gold occupies well under
    half the icon, so the middle of the dark half lands squarely on the
    background navy and never on an edge pixel between the two.
    """
    inner = icon.crop(
        (
            int(icon.width * 0.15),
            int(icon.height * 0.15),
            int(icon.width * 0.85),
            int(icon.height * 0.85),
        )
    )
    flat = inner.convert("RGB")
    data = flat.get_flattened_data() if hasattr(flat, "get_flattened_data") else flat.getdata()
    pixels = sorted(data, key=sum)
    return pixels[len(pixels) // 4]


def rounded_mask(size: int, radius_fraction: float = RADIUS) -> Image.Image:
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size * 4 - 1, size * 4 - 1),
        radius=int(size * 4 * radius_fraction),
        fill=255,
    )
    # Drawn large and reduced, because Pillow does not antialias a shape but
    # does antialias a resize. Without it the corners are visibly stepped.
    return mask.resize((size, size), Image.LANCZOS)


def crop_fraction(icon: Image.Image, spec: tuple[float, float, float]) -> Image.Image:
    """A square cut from the icon, given as centre-x, centre-y and side."""
    cx, cy, side = spec
    half = int(icon.width * side / 2)
    x, y = int(icon.width * cx), int(icon.height * cy)
    return icon.crop((x - half, y - half, x + half, y + half))


def flatten(icon: Image.Image, size: int, navy: tuple[int, int, int]) -> Image.Image:
    """
    The artwork on an opaque navy square.

    The rounded mask is the *paste* mask, not a cut: outside the artwork's own
    rounded edge the navy shows through instead of the mockup's black corners,
    which is what makes this safe to use anywhere a square is wanted.
    """
    out = Image.new("RGB", (size, size), navy)
    art = icon.resize((size, size), Image.LANCZOS).convert("RGB")
    out.paste(art, (0, 0), rounded_mask(size))
    return out


def rounded(icon: Image.Image, size: int, navy: tuple[int, int, int]) -> Image.Image:
    """The app icon proper: navy under the art, corners cut to transparent."""
    out = flatten(icon, size, navy).convert("RGBA")
    out.putalpha(rounded_mask(size))
    return out


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    icon = source.crop(CROP).crop((TRIM, TRIM, CROP[2] - CROP[0] - TRIM, CROP[3] - CROP[1] - TRIM))
    navy = body_colour(icon)
    print(f"source {source.size} -> icon {icon.size}, navy #{navy[0]:02x}{navy[1]:02x}{navy[2]:02x}")

    public = ROOT / "public"

    for size in (192, 512):
        path = public / f"icon-{size}.png"
        rounded(icon, size, navy).save(path, optimize=True)
        print(f"  {path.relative_to(ROOT)}")

    """
    Full bleed, deliberately.

    Insetting the whole icon inside its own navy field — the obvious reading of
    the safe zone — draws a rounded square inside a square and looks like a
    sticker of an app rather than an app. The rule is about *content*, and the
    M and the wordmark already sit well inside the central circle; it is only
    the corner swooshes that a round launcher mask will trim, which is what
    decoration in a corner is for.
    """
    path = public / "icon-maskable-512.png"
    flatten(icon, 512, navy).save(path, optimize=True)
    print(f"  {path.relative_to(ROOT)}")

    # iOS rounds this itself and renders anything transparent as black, so it
    # is the one icon that must be a flat opaque square.
    path = public / "apple-touch-icon.png"
    flatten(icon, 180, navy).save(path, optimize=True)
    print(f"  {path.relative_to(ROOT)}")

    """
    The browser tab, and the file that was showing Vercel's logo.

    Next.js serves src/app/favicon.ico by the file convention, and a browser
    asks for /favicon.ico by habit whatever the markup says — so leaving the
    starter's copy in place meant the tab kept showing it no matter what the
    manifest declared. All three sizes go in one file: 16 for the tab, 32 for
    the bookmark bar, 48 for a Windows shortcut.

    This one is the M alone. The full logo at sixteen pixels is a smear: the
    script wordmark is finer than a pixel at that size and turns to grey
    speckle, taking the M down with it. Zoomed to the letter, the same artwork
    is still legible in a tab — which is the only job this file has.
    """
    mark = crop_fraction(icon, MARK)
    path = ROOT / "src" / "app" / "favicon.ico"
    rounded(mark, 48, navy).save(path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"  {path.relative_to(ROOT)}")

    """
    The same crop again, for the app's own chrome.

    The sidebar and the drawer show the mark at thirty-six pixels beside the
    business name. The full logo at that size is a navy tile with an
    unreadable smudge on it — the wordmark needs about a hundred pixels before
    it is a word — and it would be saying "Munawar" directly next to text
    already saying "Munawar". The letter alone does the job and does not
    compete with it.

    128 rather than 36, so it stays sharp on a high-density screen.
    """
    path = public / "logo-mark.png"
    rounded(mark, 128, navy).save(path, optimize=True)
    print(f"  {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
