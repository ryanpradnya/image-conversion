# Recast

A browser-only image converter. Crop, resize, rotate, flip and adjust an image, then save it as PNG, JPEG, WebP, AVIF, GIF, BMP, ICO, TIFF, PDF or SVG. Drop one image to open the editor; drop several to convert them all at once. Batch mode shows every file as a thumbnail, applies the format, quality, background and a resize percentage to each, and downloads the results as one `.zip`. Images stay on the device; nothing is uploaded.

It is plain HTML, CSS and JavaScript. There is no build step and no `package.json`.

## Formats

| Reads | Writes |
| --- | --- |
| PNG, JPEG, WebP, GIF, BMP, ICO, SVG, AVIF (browser-native) | PNG, JPEG, WebP (canvas) |
| HEIC / HEIF ([heic2any](https://github.com/alexcorvi/heic2any), loaded on demand) | AVIF, plus WebP in Safari ([jSquash](https://github.com/jamsinclair/jSquash) WebAssembly, on demand) |
| TIFF ([UTIF.js](https://github.com/photopea/UTIF.js), on demand) | GIF ([gifenc](https://github.com/mattdesl/gifenc)), TIFF (UTIF.js), PDF ([jsPDF](https://github.com/parallax/jsPDF)) |
| | BMP, ICO, SVG (written in `app.js`) |

The libraries load from jsDelivr / esm.sh only when someone picks a format that needs them.

## Files

```
index.html     page markup
tokens.css     design tokens (colour, type, spacing, motion)
styles.css     layout and components
app.js         decoding, editing, encoding
check.html     encoder self-check
.github/workflows/pages.yml   GitHub Pages deploy
```

## Run locally

ES module imports need a real HTTP origin, so serve the folder instead of opening the file directly:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Open `http://localhost:8000/check.html` to encode a test image to all ten formats and check each file's signature. The page title changes to `PASS` or `FAIL`.

## Deploy to GitHub Pages

1. Push to `main`.
2. In the repository go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. The `Deploy to GitHub Pages` workflow uploads the repository root as the site. The URL appears in the workflow run.

To skip Actions, set **Source** to **Deploy from a branch** with `main` and `/ (root)` instead. Both options work because the site has no build step.

## Limits

- Edits apply to one image at a time. There is no batch conversion yet.
- iOS Safari limits a canvas to about 16.7 megapixels, so very large photos can fail there.
- SVG output embeds the raster image in an SVG file. It does not trace it into vectors.
- ICO output is capped at 256 × 256 px.
