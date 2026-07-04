// Pure, DOM-free logic for the PDF/A converter. Kept separate from main.js so
// it can be unit-tested in Node without a browser or the WASM engine.

// PDF/A definition: supplies the OutputIntent + ICC profile PDF/A requires,
// pointing at Ghostscript's own embedded sRGB profile so we ship no ICC file.
export const PDFA_DEF = `%!
[ /Title (Converted document) /DOCINFO pdfmark
[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark
[{icc_PDFA} <</N 3>> /PUT pdfmark
[{icc_PDFA} (%rom%iccprofiles/srgb.icc) (r) file /PUT pdfmark
[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark
[{OutputIntent_PDFA} <<
  /Type /OutputIntent /S /GTS_PDFA1
  /DestOutputProfile {icc_PDFA}
  /OutputConditionIdentifier (sRGB) /Info (sRGB IEC61966-2.1)
>> /PUT pdfmark
[{Catalog} <</OutputIntents [ {OutputIntent_PDFA} ]>> /PUT pdfmark
`;

/** True if the file looks like a PDF by MIME type or extension. */
export function isProbablyPdf(name = '', type = '') {
  return type === 'application/pdf' || /\.pdf$/i.test(name);
}

/** Build the Ghostscript argument list for a PDF/A conversion. */
export function buildGhostscriptArgs(level, { input = 'input.pdf', output = 'output.pdf', def = 'PDFA_def.ps' } = {}) {
  return [
    '-dPDFA=' + level,
    '-dBATCH',
    '-dNOPAUSE',
    '-dNOSAFER',
    '-sColorConversionStrategy=RGB',
    '-sDEVICE=pdfwrite',
    '-dPDFACompatibilityPolicy=1',
    '-sOutputFile=' + output,
    def,
    input,
  ];
}

/** Suggest an output base name for an input PDF (no extension). */
export function suggestOutputName(inputFilename = '') {
  return inputFilename.replace(/\.pdf$/i, '') + '_pdfa';
}

/** Normalize a user-entered name into a safe "<name>.pdf" download filename. */
export function toDownloadFilename(value) {
  let name = (value ?? '').trim() || 'converted_pdfa';
  name = name.replace(/\.pdf$/i, ''); // a single ".pdf" suffix is added back
  return name + '.pdf';
}

/**
 * Structural PDF/A check (NOT a full ISO validation). Inspects the raw bytes
 * for the PDF/A structures Ghostscript should have written and returns a list
 * of { ok, label } results.
 */
export function validatePdfA(bytes, level) {
  const txt =
    typeof bytes === 'string' ? bytes : new TextDecoder('latin1').decode(bytes);
  const partMatch = txt.match(/pdfaid[:\s"'>]*part[>="'\s]*(\d)/i);
  const confMatch = txt.match(/pdfaid[:\s"'>]*conformance[>="'\s]*([AB])/i);
  const part = partMatch ? partMatch[1] : null;

  return [
    {
      ok: txt.includes('pdfaid'),
      label: part
        ? `Declares PDF/A-${part}${confMatch ? confMatch[1].toLowerCase() : ''} in its metadata`
        : 'Declares PDF/A in its metadata',
    },
    {
      ok: txt.includes('GTS_PDFA1') && txt.includes('/OutputIntent'),
      label: 'Has a PDF/A output intent',
    },
    {
      ok: txt.includes('/DestOutputProfile'),
      label: 'Embeds an ICC colour profile',
    },
    {
      ok: !txt.includes('/Encrypt'),
      label: 'Not encrypted (required by PDF/A)',
    },
    {
      ok: part === String(level),
      label: `Conformance matches your choice (PDF/A-${level}b)`,
    },
  ];
}
