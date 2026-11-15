# DYMO Label Maker — Complete v4 Fix

This ZIP contains the **whole working Vite project**, not only the changed files. Previous font-size ZIPs omitted `src/style.css`, which `src/main.js` imports. That can cause GitHub Actions deployment failures and leave an older version live.

## Upload to GitHub

1. Unzip this archive.
2. In repository `shadows-dymo-labels`, upload the files with their same folder structure, replacing existing files.
3. Make sure `index.html`, `package.json`, `vite.config.js`, `src/main.js`, and `src/style.css` are present and that `.github/workflows/deploy.yml` still exists.
4. Commit once, then open **Actions** and verify the deployment is green.
5. Open https://akselay818.github.io/shadows-dymo-labels/ and hard refresh. Look for `LABEL FONT FIX v4`.
6. Move slider 16 to 42; both actual-size status and canvas title should change.

If the `v4` banner is absent, the site is serving an older build. If Actions fails, check the failing build step before uploading another replacement.


## v5 font controls
The −, +, slider, numeric box and reset button all set the same canvas font. The live sample near the controls changes immediately, even when the print preview is below the fold. The print function uses that canvas. Verify a single physical print before batches.
