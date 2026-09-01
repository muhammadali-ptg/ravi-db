import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ASSETS = join(import.meta.dirname, 'assets');

/** Self-contained dashboard: no network, no CDN, opens straight from disk. */
export async function renderHtml(report) {
  const [css, js] = await Promise.all([
    readFile(join(ASSETS, 'dashboard.css'), 'utf8'),
    readFile(join(ASSETS, 'dashboard.js'), 'utf8'),
  ]);

  const t = report.totals;
  const range = [report.filters.start, report.filters.end].filter(Boolean).join(' → ') || 'All time';
  const title = `${report.pipeline.name} — pipeline report`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${css}</style>
</head>
<body>
<div class="wrap">
  <header class="page">
    <h1>${esc(report.pipeline.name)}</h1>
    <div class="sub">
      <span>${esc(range)}</span>
      <span>${t.opportunities.toLocaleString()} opportunities</span>
      <span>Generated ${esc(report.generatedAt.replace('T', ' ').slice(0, 16))} UTC</span>
    </div>
  </header>

  <section class="tiles">
    ${tile('Opportunities', t.opportunities, `${t.contacts.toLocaleString()} distinct contacts`)}
    ${tile('Inbound calls', t.calls.inbound, `${share(t.calls.inbound, t.calls.total)} of all calls`)}
    ${tile('Outbound calls', t.calls.outbound, `${share(t.calls.outbound, t.calls.total)} of all calls`)}
    ${tile('Form submissions', t.forms.submissions, `${t.forms.opportunitiesWithSubmission.toLocaleString()} opportunities with a form`)}
    ${tile('Pipeline value', formatMoney(t.monetaryValue, report.currency), `${t.opportunitiesWithCalls.toLocaleString()} opportunities with calls`)}
  </section>

  <div class="grid-2">
    <section class="card">
      <h2>Opportunities by lead source</h2>
      <p class="hint">Where each opportunity in this pipeline came from.</p>
      <div id="chart-source" class="bars single"></div>
    </section>

    <section class="card">
      <h2>Calls by lead source</h2>
      <p class="hint">Inbound and outbound call volume, on one shared scale.${
        t.duplicateContacts ? ` Counted once per contact; ${t.duplicateContacts} opportunit${t.duplicateContacts === 1 ? 'y shares its' : 'ies share their'} contact with another row.` : ''
      }</p>
      <div class="legend">
        <span class="item"><span class="swatch" style="background:var(--series-1)"></span>Inbound</span>
        <span class="item"><span class="swatch" style="background:var(--series-2)"></span>Outbound</span>
      </div>
      <div id="chart-calls" class="bars"></div>
    </section>
  </div>

  <div class="grid-2" style="margin-top:20px">
    <section class="card">
      <h2>Form submissions by lead source</h2>
      <p class="hint">Submissions from contacts attached to this pipeline.</p>
      <div id="chart-forms" class="bars single"></div>
    </section>

    <section class="card">
      <h2>Opportunities by stage</h2>
      <p class="hint">Current distribution across the pipeline.</p>
      <div id="chart-stage" class="bars single"></div>
    </section>
  </div>

  <section class="card" style="margin-top:20px">
    <h2>Every opportunity</h2>
    <p class="hint">Click a column heading to sort. This table is the full data behind the charts.</p>
    <div class="controls">
      <input id="f-search" type="search" placeholder="Search name, contact, email, phone…" aria-label="Search opportunities">
      <select id="f-source" aria-label="Filter by lead source"></select>
      <select id="f-stage" aria-label="Filter by stage"></select>
    </div>
    <div class="table-scroll">
      <table>
        <thead id="thead"></thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>
    <div class="count" id="row-count"></div>
  </section>

  <footer class="page">
    Location ${esc(report.locationId)} · pipeline ${esc(report.pipeline.id)} ·
    ${report.stats.requests} API requests${report.stats.cacheHits ? `, ${report.stats.cacheHits} served from cache` : ''}.
    ${report.filters.includeCalls ? '' : 'Call data was skipped. '}${report.filters.includeForms ? '' : 'Form data was skipped. '}
  </footer>
</div>

<div id="tip" role="tooltip" aria-hidden="true"></div>
<script>window.__REPORT__ = ${embedJson(report)};</script>
<script>${js}</script>
</body>
</html>
`;
}

function tile(label, value, foot) {
  const shown = typeof value === 'number' ? value.toLocaleString() : value;
  return `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${esc(shown)}</div><div class="foot">${esc(foot)}</div></div>`;
}

function share(part, whole) {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

function formatMoney(value, currency = 'USD') {
  try {
    return value.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 0 });
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`;
  }
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Inline JSON safely: `</script>` inside any string would otherwise close the
 * script element early, and U+2028/9 are newlines to a JS parser.
 */
function embedJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
