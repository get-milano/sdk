#!/usr/bin/env python3
"""Derives every sample app's icon and launch image from two masters.

    python3 samples/scripts/generate-app-assets.py        # requires Pillow

Three sample apps on three platforms, each wanting the same mark at
different sizes, in different formats, in directories named by different
conventions. Doing that by hand is how two of them ended up shipping a
placeholder: the React Native app wore the stock Android robot and Expo's
grid-and-circles splash for its whole life, while the other two already
carried the real logo, and nobody noticed because nothing compared them.

So the assets are generated rather than curated, from:

  samples/assets/app-icon.png    1024, opaque. App icons: iOS rejects
                                 alpha, and a launcher icon should not
                                 show the wallpaper through it.
  samples/assets/logo-mark.png   512, transparent. Launch images, which
                                 sit on a background the platform picks,
                                 so they have to blend into either theme.

Not run in CI: it needs Pillow, and this repository's Android and iOS
lanes have no Python image stack. The outputs are committed, and
scripts/check-consistency.mjs asserts the three apps still ship the same
icon, which is the part that actually drifted.
"""

import shutil
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("this script needs Pillow: pip3 install Pillow", file=sys.stderr)
    sys.exit(2)

SAMPLES = Path(__file__).resolve().parent.parent
ASSETS = SAMPLES / "assets"

# Android's density ladder. mdpi is the 1x baseline; a launcher icon is
# 48dp and a launch image 288dp, so each row is those two at that density.
DENSITIES = [
    ("mdpi", 1.0),
    ("hdpi", 1.5),
    ("xhdpi", 2.0),
    ("xxhdpi", 3.0),
    ("xxxhdpi", 4.0),
]
LAUNCHER_DP = 48
LAUNCH_IMAGE_DP = 288

written = []


def write(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)
    written.append(path.relative_to(SAMPLES))


def square(master, size):
    """Resized with the best filter Pillow has; these are down-samples."""
    return master.resize((size, size), Image.LANCZOS)


def android_icons(master, res_dir, round_variant=False):
    for name, scale in DENSITIES:
        size = int(LAUNCHER_DP * scale)
        icon = square(master, size)
        write(icon, res_dir / f"mipmap-{name}" / "ic_launcher.png")
        if round_variant:
            # A round launcher icon has to actually be round: Android does
            # not mask it, it just uses the drawable as given.
            circular = icon.convert("RGBA")
            mask = Image.new("L", (size, size), 0)
            from PIL import ImageDraw
            ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
            circular.putalpha(mask)
            write(circular, res_dir / f"mipmap-{name}" / "ic_launcher_round.png")


def android_launch_image(mark, res_dir, filename):
    for name, scale in DENSITIES:
        size = int(LAUNCH_IMAGE_DP * scale)
        write(square(mark, size), res_dir / f"drawable-{name}" / filename)


def ios_image_set(mark, imageset, basename):
    """1x/2x/3x plus the Contents.json that names them."""
    for scale in (1, 2, 3):
        size = LAUNCH_IMAGE_DP * scale // 2
        suffix = "" if scale == 1 else f"@{scale}x"
        write(square(mark, size), imageset / f"{basename}{suffix}.png")
    entries = ",\n".join(
        f"""    {{
      "filename" : "{basename}{'' if s == 1 else f'@{s}x'}.png",
      "idiom" : "universal",
      "scale" : "{s}x"
    }}"""
        for s in (1, 2, 3)
    )
    contents = f"""{{
  "images" : [
{entries}
  ],
  "info" : {{
    "author" : "xcode",
    "version" : 1
  }}
}}
"""
    (imageset / "Contents.json").write_text(contents)
    written.append((imageset / "Contents.json").relative_to(SAMPLES))


def main():
    icon = Image.open(ASSETS / "app-icon.png").convert("RGB")
    mark = Image.open(ASSETS / "logo-mark.png").convert("RGBA")
    if icon.size != (1024, 1024):
        raise SystemExit(f"app-icon.png must be 1024 square, is {icon.size}")

    # --- SwiftUI: one 1024 icon, and a launch image for UILaunchScreen.
    swiftui = SAMPLES / "swiftui" / "Resources" / "Assets.xcassets"
    write(icon, swiftui / "AppIcon.appiconset" / "icon-1024.png")
    ios_image_set(mark, swiftui / "LaunchLogo.imageset", "launch-logo")

    # --- Compose: legacy launcher mipmaps, and a launch image the theme
    # centres. No round variant: the manifest declares no roundIcon.
    compose = SAMPLES / "compose" / "app" / "src" / "main" / "res"
    android_icons(icon, compose)
    android_launch_image(mark, compose, "splash_logo.png")

    # --- React Native: both platforms, through the committed prebuild.
    rn = SAMPLES / "react-native"
    write(icon, rn / "ios" / "Milano" / "Images.xcassets" /
          "AppIcon.appiconset" / "App-Icon-1024x1024@1x.png")
    ios_image_set(mark, rn / "ios" / "Milano" / "Images.xcassets" /
                  "SplashScreen.imageset", "splashscreen-logo")
    rn_res = rn / "android" / "app" / "src" / "main" / "res"
    android_icons(icon, rn_res, round_variant=True)
    android_launch_image(mark, rn_res, "splashscreen_logo.png")

    # Expo's prebuild wrote these as WebP. Leaving them beside the PNGs is
    # a duplicate-resource error, not a preference.
    stale = [p for name, _ in DENSITIES
             for p in (rn_res / f"mipmap-{name}").glob("ic_launcher*.webp")]
    for path in stale:
        path.unlink()

    print(f"wrote {len(written)} files")
    for path in sorted(written):
        print(f"  {path}")
    if stale:
        print(f"removed {len(stale)} superseded .webp launcher icons")


if __name__ == "__main__":
    main()
