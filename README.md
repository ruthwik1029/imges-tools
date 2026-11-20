# ISR HR Smart Compressor

A privacy-focused image compression and PDF conversion workspace. Image and PDF bytes are processed locally in the browser.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`.

## Verify and build

```bash
pnpm test
pnpm run build
pnpm preview
```

## Processing support

- PNG, JPEG, WebP, and browser-decodable AVIF input
- HEIC and HEIF input when the browser exposes a decoder
- JPEG, PNG, WebP, and browser-supported AVIF output
- Iterative target-size encoding in a Web Worker
- Sampled luminance comparison to enforce a configurable visual-quality boundary
- Images to PDF through `pdf-lib`
- PDF page rendering through `pdfjs-dist`
- ZIP archives through `JSZip`

All displayed output sizes and savings are measured from generated `Blob` objects. Browser codec support determines whether AVIF and HEIC operations are available.
