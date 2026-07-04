// Import the Emscripten factory directly. The package's gs.mjs ESM wrapper is
// written for a raw <script> tag (it reads globalThis.exports.Module) and does
// not work under a bundler, so we use the CommonJS gs.js factory instead.
import gsFactory from '@jspawn/ghostscript-wasm/gs.js';
import gsWasmUrl from '@jspawn/ghostscript-wasm/gs.wasm?url';
import {
  PDFA_DEF,
  isProbablyPdf,
  buildGhostscriptArgs,
  suggestOutputName,
  toDownloadFilename,
  validatePdfA,
} from './pdfa.js';

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const conformance = document.getElementById('conformance');
const statusEl = document.getElementById('status');
const progressEl = document.getElementById('progress');
const progressBar = document.getElementById('progress-bar');
const resultEl = document.getElementById('result');
const outNameInput = document.getElementById('out-name');
const downloadLink = document.getElementById('download-link');
const validationList = document.getElementById('validation-list');

let lastUrl = null; // revoke old object URLs to avoid memory leaks

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

// --- Engine loading (with download progress) -------------------------------
// The ~15 MB WASM is downloaded once, compiled once, then reused. We stream the
// download so we can show a real progress bar on the first visit.
let wasmModulePromise = null;

async function downloadWasm(onProgress) {
  const resp = await fetch(gsWasmUrl);
  if (!resp.ok) throw new Error('Failed to download engine (HTTP ' + resp.status + ')');
  const total = Number(resp.headers.get('Content-Length')) || 0;
  if (!resp.body) return new Uint8Array(await resp.arrayBuffer());

  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(received, total);
  }
  const bytes = new Uint8Array(received);
  let pos = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, pos);
    pos += chunk.length;
  }
  return bytes;
}

// Returns a compiled WebAssembly.Module, downloading only on the first call.
function getWasmModule(onProgress) {
  if (!wasmModulePromise) {
    wasmModulePromise = downloadWasm(onProgress)
      .then((bytes) => WebAssembly.compile(bytes))
      .catch((err) => {
        wasmModulePromise = null; // allow a retry on failure
        throw err;
      });
  }
  return wasmModulePromise;
}

function showProgress(received, total) {
  progressEl.hidden = false;
  if (total) {
    const pct = Math.round((received / total) * 100);
    progressBar.style.width = pct + '%';
    setStatus(`Downloading converter engine… ${pct}%`, 'working');
  } else {
    const mb = (received / 1048576).toFixed(1);
    setStatus(`Downloading converter engine… ${mb} MB`, 'working');
  }
}

// --- File pickers ----------------------------------------------------------
browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) convert(fileInput.files[0]);
});

['dragenter', 'dragover'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  })
);
dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) convert(file);
});

// Keep the download filename in sync with the "Save as" field.
function syncDownloadName() {
  const filename = toDownloadFilename(outNameInput.value);
  downloadLink.download = filename;
  downloadLink.textContent = 'Download ' + filename;
}
outNameInput.addEventListener('input', syncDownloadName);

function renderValidation(results) {
  validationList.innerHTML = '';
  for (const r of results) {
    const li = document.createElement('li');
    li.className = r.ok ? 'pass' : 'fail';
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = r.ok ? '✓' : '✗';
    const text = document.createElement('span');
    text.textContent = r.label;
    li.append(mark, text);
    validationList.appendChild(li);
  }
}

// --- Conversion ------------------------------------------------------------
async function convert(file) {
  if (!isProbablyPdf(file.name, file.type)) {
    setStatus('That does not look like a PDF.', 'error');
    return;
  }

  resultEl.hidden = true; // clear any previous result while we work

  try {
    const cached = wasmModulePromise !== null;
    setStatus(cached ? 'Preparing the engine…' : 'Loading the conversion engine…', 'working');

    // Download + compile the engine (only the first time), then instantiate a
    // fresh module so each conversion starts with a clean virtual filesystem.
    const compiled = await getWasmModule(showProgress);
    progressEl.hidden = true;
    const mod = await gsFactory({
      instantiateWasm(imports, success) {
        WebAssembly.instantiate(compiled, imports).then((instance) => success(instance));
        return {};
      },
    });

    const pdfBytes = new Uint8Array(await file.arrayBuffer());
    mod.FS.writeFile('input.pdf', pdfBytes);
    mod.FS.writeFile('PDFA_def.ps', PDFA_DEF);

    setStatus('Converting to PDF/A…', 'working');
    // Yield to the renderer so the "Converting…" state paints before the
    // synchronous Ghostscript call blocks the main thread.
    await new Promise((r) => setTimeout(r, 0));

    const level = conformance.value; // "1" | "2" | "3"
    const exitCode = mod.callMain(buildGhostscriptArgs(level));

    if (exitCode !== 0) {
      throw new Error('Ghostscript exited with code ' + exitCode);
    }

    const out = mod.FS.readFile('output.pdf');
    if (!out || out.length === 0) {
      throw new Error('Conversion produced an empty file.');
    }

    const blob = new Blob([out], { type: 'application/pdf' });
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);
    downloadLink.href = lastUrl;

    // Prefill the "Save as" field and wire up the download name.
    outNameInput.value = suggestOutputName(file.name);
    syncDownloadName();

    // Run the structural check and reveal the result panel.
    renderValidation(validatePdfA(out, level));
    resultEl.hidden = false;

    const kb = Math.round(blob.size / 1024);
    setStatus(`Done — PDF/A-${level}b ready (${kb} KB).`, 'ok');
  } catch (err) {
    console.error(err);
    progressEl.hidden = true;
    setStatus('Conversion failed: ' + err.message, 'error');
  }
}

setStatus('Ready — drop a PDF to convert.');
