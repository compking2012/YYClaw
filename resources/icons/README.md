# ClawX Application Icons

This directory contains the application icons for all supported platforms.

## Required Files

| File | Platform | Description |
|------|----------|-------------|
| `icon.svg` | Source | Vector source for all icons |
| `icon.icns` | macOS | Apple Icon Image format |
| `icon.ico` | Windows | Windows ICO format |
| `icon.png` | All | 512x512 PNG fallback |
| `16x16.png` - `512x512.png` | Linux | PNG set for Linux |
| `tray-icon-Template.png` | macOS | 22x22 status bar icon (note: "Template" suffix required) |
| `tray-icon-Template@2x.png` | macOS | 44x44 retina status bar icon |

## Generating Icons

### Using the Script

```bash
# Make the script executable
chmod +x scripts/generate-icons.sh

# Run icon generation
./scripts/generate-icons.sh
```

### Prerequisites

**macOS:**
```bash
brew install imagemagick librsvg
```

**Linux:**
```bash
apt install imagemagick librsvg2-bin
```

**Windows:**
Install ImageMagick from https://imagemagick.org/

### Manual Generation

If you prefer to generate icons manually:

1. **macOS (.icns)**
   - Create a `.iconset` folder with properly named PNGs
   - Run: `iconutil -c icns -o icon.icns ClawX.iconset`

2. **Windows (.ico)**
   - Use ImageMagick: `convert icon_16.png icon_32.png icon_64.png icon_128.png icon_256.png icon.ico`

3. **Linux (PNGs)**
   - Generate PNGs at: 16, 32, 48, 64, 128, 256, 512 pixels

## Design Guidelines

### Application Icon
- **Corner Radius**: ~20% of width (200px on 1024px canvas)
- **Foreground**: White claw symbol with "X" accent
- **Safe Area**: Keep 10% margin from edges

### macOS Tray Icon
- **Format**: Single-color (black) on transparent background
- **Size**: 22x22 pixels, with a 44x44 `@2x` retina variant
- **Naming**: Must end with "Template.png" for automatic template mode
- **Design**: Monochrome silhouette of the main app icon (ClawX lobster)
- **Source**: Generated automatically from `icon.svg` (alpha channel flattened to pure black)
- **Important**: macOS template images are tinted by the system (black in light menu bar, white in dark); only the alpha channel matters

## Updating the Icon

1. Edit `icon.svg` with your vector editor (Figma, Illustrator, Inkscape)
2. Run `node scripts/generate-icons.mjs` — this regenerates all platform icons, including the macOS tray template (`tray-icon-Template.png` / `@2x`) derived from `icon.svg`
3. Verify generated icons look correct
4. Commit all generated files
