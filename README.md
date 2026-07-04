# PDF to PDF/A converter

A small web app that converts PDF files to PDF/A, the archival format used for
long-term document storage. Everything runs in the browser — files are never
uploaded anywhere.

Live: https://pdfa-converter.pages.dev

## How it works

The conversion is done by Ghostscript compiled to WebAssembly, so the actual
PDF processing happens on the user's machine. The ~15 MB engine downloads once
(with a progress bar) and is cached after that. Because nothing leaves the
browser, there's no backend to run and no data to store.

After converting, the app runs a quick structural check on the output (output
intent, embedded ICC profile, PDF/A metadata, no encryption). It's a sanity
check, not a full ISO validation — run the file through
[veraPDF](https://verapdf.org/) if you need certification-grade results.

## Running locally

```
npm install
npm run dev
```

If you're behind a TLS-inspecting proxy and `npm install` fails with a
certificate error, run it with `NODE_OPTIONS=--use-system-ca`.

## Tests

```
npm test          # unit tests (Vitest)
npm run test:e2e  # headless browser test, needs the dev server running
```

The unit tests cover the pure logic in `src/pdfa.js` (validation, filename
handling, Ghostscript arguments). The e2e test drives a real Chrome instance
through an actual conversion.

## Deploying

Hosted on Cloudflare Pages:

```
npm run deploy
```

## License

Ghostscript is licensed under the AGPL, so this project is too. See the
Ghostscript license for details.
