# Shadows & Sweethearts — DYMO LabelWriter 550 Browser Label Maker

**Purpose:** Print one or more genuine DYMO 30336 labels (25 × 54 mm / 1 × 2⅛ in) via Chrome WebUSB on a Chromebook, with product name, USD price, SKU, and real Code 128 barcode.

## First-time GitHub Pages hosting (no Linux needed)

1. On github.com create a new repository, e.g. `shadows-dymo-labels`. Choose **Public** for free GitHub Pages if your plan requires it. **Do not upload private product/inventory data.**
2. Download this ZIP and extract it in the Chromebook Files app.
3. On your GitHub repository click **Add file → Upload files**. Upload `index.html`, `package.json`, `vite.config.js`, `src/main.js`, `src/style.css`, and `.github/workflows/deploy.yml`. Preserve the folders and filenames. GitHub's browser upload may not preserve hidden `.github` directories; if so, use **Add file → Create new file** and type `.github/workflows/deploy.yml`, then paste the file contents from the ZIP.
4. In **Settings → Pages**, choose **Build and deployment → Source: GitHub Actions**.
5. Go to **Actions → Deploy label maker to GitHub Pages** to see build/deploy. The website appears at `https://YOUR-USERNAME.github.io/shadows-dymo-labels/` (replace username/repo name). GitHub deployment might need an initial workflow rerun after Pages is enabled.
6. Open that HTTPS page in Chrome on your Chromebook. Plug in the printer, click **Connect DYMO 550**, choose the already-paired device if prompted, and click **Print label** with Copies=1. Verify physical layout and barcode scanning.

## Optional local development on Linux (not necessary for hosting)

`npm install && npm run dev`, then open the supplied localhost URL. Requires Node.js 20+ and internet to install dependencies.

## Notes / safety

- Driver packages: @thermal-label/labelwriter-web and -core v0.6.4 (MIT, unofficial). Barcode: JsBarcode 3.11.6 (Code 128 with checksum). Vite bundles all dependencies on GitHub Actions; the shipped website does not need a separate print server.
- Printer requires genuine NFC-authenticated DYMO 550-compatible labels. It reports loaded media electronically; wrong media dimensions are blocked if detection data is available.
- App does not upload product records; inputs are tab-local and not saved. Hosting the static app publicly does not expose product entries you type locally.
- If the hosted app connects but print fails, compare the exact runtime error and the driver version; the diagnostic harness may use a newer library version than this pinned build.
- Labels are 54 mm across the printhead and 25 mm in feed direction. Canvas is 638 × 295 printer dots at 300 DPI. Scanner compatibility should be tested with your actual Square POS scanner before batch printing.
- This has been source-checked, but **cannot be hardware-tested remotely**. Physical printing and barcode scanning require verification on your Chromebook.

Reference driver docs: https://thermal-label.github.io/labelwriter/web
Label size: https://www.dymo.com/labels-tapes/labelwriter-labels/dymo-labelwriter-multi-purpose-labels-1-roll-of-500/SP_1403088.html
