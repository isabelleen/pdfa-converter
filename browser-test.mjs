import puppeteer from 'puppeteer-core';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.APP_URL || 'http://localhost:5173/';
const INPUT_PDF = path.resolve('./sample-input.pdf');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});

try {
  const page = await browser.newPage();
  page.on('console', (m) => console.log('  [browser]', m.text()));
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

  console.log('Opening', URL);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });

  const title = await page.$eval('h1', (el) => el.textContent);
  console.log('Page heading:', title);

  // Record every status message so we can confirm the download-progress phase.
  await page.evaluate(() => {
    window.__statusLog = [];
    const el = document.getElementById('status');
    new MutationObserver(() => window.__statusLog.push(el.textContent)).observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });

  // Upload the sample PDF into the (hidden) file input.
  const input = await page.$('#file-input');
  await input.uploadFile(INPUT_PDF);
  console.log('Uploaded sample-input.pdf, waiting for conversion…');

  // Wait until status reaches a terminal state (ok or error).
  await page.waitForFunction(
    () => {
      const s = document.getElementById('status');
      return s && (s.className.includes('ok') || s.className.includes('error'));
    },
    { timeout: 60000 }
  );

  const status = await page.$eval('#status', (el) => el.textContent);
  const statusClass = await page.$eval('#status', (el) => el.className);
  console.log('\nFinal status:', JSON.stringify(status));
  console.log('Status class :', statusClass);

  // Result panel: prefilled name + structural check.
  const prefill = await page.$eval('#out-name', (el) => el.value);
  console.log('Prefilled name:', JSON.stringify(prefill));
  const checks = await page.$$eval('#validation-list li', (lis) =>
    lis.map((li) => ({ label: li.querySelector('span:last-child').textContent, pass: li.classList.contains('pass') }))
  );
  console.log('Structural check:');
  checks.forEach((c) => console.log('  ' + (c.pass ? '✓' : '✗') + ' ' + c.label));

  // Rename should flow through to the download attribute.
  await page.$eval('#out-name', (el) => { el.value = 'my archive'; el.dispatchEvent(new Event('input')); });
  const dl = await page.$eval('#download-link', (el) => el.getAttribute('download'));
  console.log('Download name after rename:', JSON.stringify(dl));
  const renameOk = dl === 'my archive.pdf';
  const checksOk = checks.length > 0 && checks.every((c) => c.pass);

  // Confirm the engine download reported progress.
  const statusLog = await page.evaluate(() => window.__statusLog);
  const sawDownload = statusLog.some((s) => /Downloading converter engine/.test(s));
  console.log('Saw download-progress phase:', sawDownload);
  const progressHidden = await page.$eval('#progress', (el) => el.hidden);
  console.log('Progress bar hidden after finish:', progressHidden);

  if (statusClass.includes('ok') && renameOk && checksOk && sawDownload && progressHidden) {
    // Pull the generated PDF/A out of the download link's blob URL.
    const dataUrl = await page.evaluate(async () => {
      const href = document.getElementById('download-link').href;
      const blob = await fetch(href).then((r) => r.blob());
      return await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(blob);
      });
    });
    const b64 = dataUrl.split(',')[1];
    const bytes = Buffer.from(b64, 'base64');
    await writeFile('./browser-output-pdfa.pdf', bytes);
    const txt = bytes.toString('latin1');
    console.log('\nGenerated PDF/A:', bytes.length, 'bytes');
    console.log('  /OutputIntents    :', txt.includes('/OutputIntents'));
    console.log('  GTS_PDFA1         :', txt.includes('GTS_PDFA1'));
    console.log('  pdfaid metadata   :', txt.includes('pdfaid'));
    console.log('  DestOutputProfile :', txt.includes('/DestOutputProfile'));
    console.log('\nRESULT: PASS ✅');
  } else {
    console.log('\nRESULT: FAIL ❌');
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
