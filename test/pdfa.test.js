import { describe, it, expect } from 'vitest';
import {
  PDFA_DEF,
  isProbablyPdf,
  buildGhostscriptArgs,
  suggestOutputName,
  toDownloadFilename,
  validatePdfA,
} from '../src/pdfa.js';

describe('isProbablyPdf', () => {
  it('accepts the PDF mime type regardless of name', () => {
    expect(isProbablyPdf('whatever', 'application/pdf')).toBe(true);
  });
  it('accepts a .pdf extension case-insensitively', () => {
    expect(isProbablyPdf('Report.PDF', '')).toBe(true);
    expect(isProbablyPdf('a.pdf', 'application/octet-stream')).toBe(true);
  });
  it('rejects non-pdf files', () => {
    expect(isProbablyPdf('image.png', 'image/png')).toBe(false);
    expect(isProbablyPdf('', '')).toBe(false);
  });
});

describe('buildGhostscriptArgs', () => {
  it('embeds the requested conformance level', () => {
    expect(buildGhostscriptArgs('1')).toContain('-dPDFA=1');
    expect(buildGhostscriptArgs('3')).toContain('-dPDFA=3');
  });
  it('targets the pdfwrite device and required PDF/A flags', () => {
    const args = buildGhostscriptArgs('2');
    expect(args).toContain('-sDEVICE=pdfwrite');
    expect(args).toContain('-dPDFACompatibilityPolicy=1');
    expect(args).toContain('-sColorConversionStrategy=RGB');
  });
  it('passes the definition file before the input, and names the output', () => {
    const args = buildGhostscriptArgs('2');
    expect(args).toContain('-sOutputFile=output.pdf');
    expect(args.indexOf('PDFA_def.ps')).toBeLessThan(args.indexOf('input.pdf'));
    expect(args[args.length - 1]).toBe('input.pdf');
  });
  it('honors custom file names', () => {
    const args = buildGhostscriptArgs('2', { input: 'in.pdf', output: 'out.pdf', def: 'd.ps' });
    expect(args).toContain('-sOutputFile=out.pdf');
    expect(args).toContain('in.pdf');
    expect(args).toContain('d.ps');
  });
});

describe('suggestOutputName', () => {
  it('strips the extension and appends _pdfa', () => {
    expect(suggestOutputName('report.pdf')).toBe('report_pdfa');
    expect(suggestOutputName('MyDoc.PDF')).toBe('MyDoc_pdfa');
  });
  it('handles names without an extension', () => {
    expect(suggestOutputName('report')).toBe('report_pdfa');
  });
  it('only strips a trailing .pdf, not one mid-name', () => {
    expect(suggestOutputName('my.pdf.backup.pdf')).toBe('my.pdf.backup_pdfa');
  });
});

describe('toDownloadFilename', () => {
  it('adds a single .pdf extension', () => {
    expect(toDownloadFilename('archive')).toBe('archive.pdf');
  });
  it('does not double the extension', () => {
    expect(toDownloadFilename('archive.pdf')).toBe('archive.pdf');
    expect(toDownloadFilename('archive.PDF')).toBe('archive.pdf');
  });
  it('trims whitespace', () => {
    expect(toDownloadFilename('  spaced  ')).toBe('spaced.pdf');
  });
  it('falls back to a default for empty/blank/nullish input', () => {
    expect(toDownloadFilename('')).toBe('converted_pdfa.pdf');
    expect(toDownloadFilename('   ')).toBe('converted_pdfa.pdf');
    expect(toDownloadFilename(null)).toBe('converted_pdfa.pdf');
    expect(toDownloadFilename(undefined)).toBe('converted_pdfa.pdf');
  });
});

describe('validatePdfA', () => {
  // A minimal blob containing every marker a compliant PDF/A-2 file should have.
  const compliant =
    '%PDF-1.7 ... <xmp> pdfaid:part="2" pdfaid:conformance="B" </xmp> ' +
    '/OutputIntent /S /GTS_PDFA1 /DestOutputProfile 5 0 R ...';

  it('passes every check on a compliant file at the matching level', () => {
    const results = validatePdfA(compliant, '2');
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('reads the declared level back into the label', () => {
    const results = validatePdfA(compliant, '2');
    expect(results[0].label).toContain('PDF/A-2b');
  });

  it('flags a level mismatch', () => {
    const results = validatePdfA(compliant, '1'); // file is actually part 2
    const mismatch = results.find((r) => r.label.includes('Conformance matches'));
    expect(mismatch.ok).toBe(false);
  });

  it('fails the output-intent check when GTS_PDFA1 is missing', () => {
    const noIntent = 'pdfaid:part="2" /DestOutputProfile 5 0 R';
    const results = validatePdfA(noIntent, '2');
    const intent = results.find((r) => r.label.includes('output intent'));
    expect(intent.ok).toBe(false);
  });

  it('fails the encryption check when /Encrypt is present', () => {
    const encrypted = compliant + ' /Encrypt 9 0 R';
    const results = validatePdfA(encrypted, '2');
    const enc = results.find((r) => r.label.includes('Not encrypted'));
    expect(enc.ok).toBe(false);
  });

  it('reports "Declares PDF/A" generically when no part is parseable', () => {
    // "pdfaid" present but no parseable part number.
    const vague = 'pdfaid present but malformed /OutputIntent /S /GTS_PDFA1 /DestOutputProfile';
    const results = validatePdfA(vague, '2');
    expect(results[0].ok).toBe(true);
    expect(results[0].label).toBe('Declares PDF/A in its metadata');
  });

  it('accepts raw bytes (Uint8Array), not just strings', () => {
    const bytes = new TextEncoder().encode(compliant);
    const results = validatePdfA(bytes, '2');
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('fails the metadata check on a non-PDF/A file', () => {
    const plain = '%PDF-1.4 just a normal pdf with no pdfa markers';
    const results = validatePdfA(plain, '2');
    expect(results[0].ok).toBe(false); // no pdfaid
  });
});

describe('PDFA_DEF', () => {
  it('references Ghostscript’s embedded sRGB profile and an output intent', () => {
    expect(PDFA_DEF).toContain('%rom%iccprofiles/srgb.icc');
    expect(PDFA_DEF).toContain('GTS_PDFA1');
    expect(PDFA_DEF).toContain('/OutputIntents');
  });
});
