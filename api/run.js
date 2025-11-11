// api/run.js
export default async function handler(req, res) {
  // --- CORS (allow your site) ---
  const ORIGIN = req.headers.origin || '';
  const ALLOWED = [
    'https://pinedesignmarketing.com',
    'https://www.pinedesignmarketing.com',
    'http://localhost:3000' // remove when done
  ];
  if (ALLOWED.includes(ORIGIN)) {
    res.setHeader('Access-Control-Allow-Origin', ORIGIN);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Use POST { url }' });
    }
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Missing url' });

    const key = process.env.PSI_KEY;        // set in Vercel
    const strategy = 'mobile';              // or 'desktop'

    const psiURL = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    psiURL.searchParams.set('url', url);
    psiURL.searchParams.set('key', key);
    psiURL.searchParams.set('strategy', strategy);

    const r = await fetch(psiURL);
    if (!r.ok) return res.status(r.status).json({ error: 'PSI error', detail: await r.text() });
    const data = await r.json();

    const lr = data.lighthouseResult || {};
    const audits = lr.audits || {};
    const cats = lr.categories || {};
    const score = Math.round((cats.performance?.score ?? 0) * 100);

    const lcp = audits['largest-contentful-paint']?.numericValue
      ? audits['largest-contentful-paint'].numericValue / 1000 : null;
    const cls = audits['cumulative-layout-shift']?.numericValue ?? null;

    let inp = audits['experimental-interaction-to-next-paint']?.numericValue;
    if (inp == null) inp = audits['max-potential-fid']?.numericValue ?? null;

    const reqs = audits['network-requests']?.details?.items?.length ?? null;
    const bytes = audits['total-byte-weight']?.numericValue ?? null;
    const pageSizeMB = bytes ? (bytes / (1024 * 1024)) : null;

    const loadTimeS = audits['speed-index']?.numericValue
      ? audits['speed-index'].numericValue / 1000
      : audits['interactive']?.numericValue
        ? audits['interactive'].numericValue / 1000
        : null;

    // Issues (used by your front-end)
    const issues = [];
    const addIssue = (key, label, grade, tip) => issues.push({ key, label, grade, tip });

    if (reqs != null && reqs > 90) addIssue('http_requests', 'Make fewer HTTP requests', 'F');
    else if (reqs != null && reqs > 60) addIssue('http_requests', 'Make fewer HTTP requests', 'D');
    else if (reqs != null && reqs > 40) addIssue('http_requests', 'Make fewer HTTP requests', 'C');
    else addIssue('http_requests', 'Make fewer HTTP requests', 'B');

    const cacheScore = audits['uses-long-cache-ttl']?.score;
    if (cacheScore == null) addIssue('expires_headers', 'Add Expires headers', 'C');
    else if (cacheScore >= 0.9) addIssue('expires_headers', 'Add Expires headers', 'A');
    else if (cacheScore >= 0.7) addIssue('expires_headers', 'Add Expires headers', 'B');
    else if (cacheScore >= 0.4) addIssue('expires_headers', 'Add Expires headers', 'C');
    else addIssue('expires_headers', 'Add Expires headers', 'D');

    const compression = audits['uses-text-compression']?.score;
    if (compression == null) addIssue('gzip', 'Compress components with gzip/brotli', 'C');
    else if (compression >= 0.9) addIssue('gzip', 'Compress components with gzip/brotli', 'A');
    else if (compression >= 0.7) addIssue('gzip', 'Compress components with gzip/brotli', 'B');
    else if (compression >= 0.4) addIssue('gzip', 'Compress components with gzip/brotli', 'C');
    else addIssue('gzip', 'Compress components with gzip/brotli', 'D');

    // external hosts → “DNS lookups”
    let externalHosts = 0;
    const items = audits['network-requests']?.details?.items ?? [];
    const originHost = new URL(url).host;
    const seen = new Set();
    for (const it of items) {
      try {
        const h = new URL(it.url).host;
        if (!seen.has(h)) { seen.add(h); if (h !== originHost) externalHosts++; }
      } catch {}
    }
    if (externalHosts > 6) addIssue('dns', 'Reduce DNS lookups', 'D');
    else if (externalHosts > 4) addIssue('dns', 'Reduce DNS lookups', 'C');
    else if (externalHosts > 2) addIssue('dns', 'Reduce DNS lookups', 'B');
    else addIssue('dns', 'Reduce DNS lookups', 'A');

    addIssue('cookies', 'Use cookie-free domains for static assets', 'B');
    addIssue('empty_src', 'Avoid empty src or href', 'A');

    return res.status(200).json({
      score, lcp, cls, inp,
      requests: reqs,
      pageSizeMB,
      loadTimeS,
      issues
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error', detail: e?.message });
  }
}
