import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GhlClient } from '../src/ghl/client.js';
import { buildReport } from '../src/report.js';
import { renderHtml } from '../src/render/html.js';
import { renderCsv } from '../src/render/csv.js';
import { installFetchStub, makeFixture } from './fixtures.js';

function client() {
  return new GhlClient({ token: 'test-token', locationId: 'loc-1', baseUrl: 'https://ghl.test' });
}

test('buildReport joins opportunities to calls, forms and lead source', async (t) => {
  const fixture = makeFixture({ opportunityCount: 5 });
  const requests = [];
  t.after(installFetchStub(fixture, { pageSize: 2, calls: requests }));

  const report = await buildReport(client(), { pipelineName: 'Sales Pipeline', concurrency: 3 });

  assert.equal(report.pipeline.id, 'pipe-1');
  assert.equal(report.opportunities.length, 5, 'cursor pagination walked all three pages');
  assert.equal(new Set(report.opportunities.map((r) => r.opportunityId)).size, 5, 'no duplicates across pages');

  // Each fixture contact has 1 inbound and 2 outbound calls, and the SMS is ignored.
  assert.equal(report.totals.calls.inbound, 5);
  assert.equal(report.totals.calls.outbound, 10);
  assert.equal(report.totals.calls.total, 15);

  // Every contact submitted one form; even-indexed contacts submitted two.
  assert.equal(report.totals.forms.submissions, 8);
  assert.equal(report.totals.forms.opportunitiesWithSubmission, 5);

  const first = report.opportunities.find((r) => r.opportunityId === 'opp-0');
  assert.equal(first.stage, 'New Lead');
  assert.equal(first.leadSource.source, 'Facebook Ads');
  assert.equal(first.calls.inbound, 1);
  assert.equal(first.calls.outbound, 2);
  assert.equal(first.forms.submissions, 2);
  assert.deepEqual(first.forms.names, ['Contact Us', 'Quote Request']);
  assert.equal(first.email, 'c0@example.com');

  // Odd opportunities carry no source, so attribution has to supply it.
  const second = report.opportunities.find((r) => r.opportunityId === 'opp-1');
  assert.equal(second.leadSource.source, 'google');
  assert.equal(second.leadSource.resolvedFrom, 'attribution.utmSource');
  assert.equal(second.leadSource.channel, 'Search');

  assert.equal(
    report.totals.bySource.reduce((sum, b) => sum + b.opportunities, 0),
    5,
    'source buckets partition the opportunities',
  );

  // Form submissions are fetched location-wide, not once per contact.
  assert.equal(requests.filter((r) => r.startsWith('/forms/submissions')).length, 1);
});

test('date filtering narrows the report', async (t) => {
  const fixture = makeFixture({ opportunityCount: 6 });
  t.after(installFetchStub(fixture, { pageSize: 3 }));

  const report = await buildReport(client(), {
    pipelineName: 'Sales Pipeline',
    start: '2026-03-01',
    end: '2026-05-31',
  });

  const months = report.opportunities.map((r) => r.createdAt.slice(0, 7));
  assert.ok(months.every((m) => m >= '2026-03' && m <= '2026-05'), `unexpected months: ${months}`);
  assert.equal(report.filters.start, '2026-03-01');
});

test('--no-calls and --no-attribution skip their API calls entirely', async (t) => {
  const fixture = makeFixture({ opportunityCount: 3 });
  const requests = [];
  t.after(installFetchStub(fixture, { pageSize: 3, calls: requests }));

  const report = await buildReport(client(), {
    pipelineName: 'Sales Pipeline',
    includeCalls: false,
    includeAttribution: false,
  });

  assert.equal(report.totals.calls.total, 0);
  assert.equal(requests.filter((r) => r.startsWith('/conversations')).length, 0);
  assert.equal(requests.filter((r) => r.startsWith('/contacts/')).length, 0);
  // Without attribution the opportunity's own source is all that is left.
  assert.equal(report.opportunities.find((r) => r.opportunityId === 'opp-1').leadSource.source, 'Unknown');
});

test('a missing contact does not abort the run', async (t) => {
  const fixture = makeFixture({ opportunityCount: 3 });
  fixture.contacts.delete('contact-1');
  t.after(installFetchStub(fixture, { pageSize: 3 }));

  const report = await buildReport(client(), { pipelineName: 'Sales Pipeline' });
  assert.equal(report.opportunities.length, 3);
  const orphan = report.opportunities.find((r) => r.opportunityId === 'opp-1');
  assert.equal(orphan.leadSource.source, 'Unknown');
  assert.equal(orphan.calls.inbound, 1, 'calls still resolve without the contact record');
});

test('an unknown pipeline name fails with the available names', async (t) => {
  t.after(installFetchStub(makeFixture({ opportunityCount: 1 })));
  await assert.rejects(
    buildReport(client(), { pipelineName: 'Nope' }),
    /Pipeline "Nope" not found.*Sales Pipeline \(pipe-1\)/s,
  );
});

test('renderHtml produces a standalone page with no external requests', async (t) => {
  const fixture = makeFixture({ opportunityCount: 4 });
  t.after(installFetchStub(fixture, { pageSize: 4 }));

  const report = await buildReport(client(), { pipelineName: 'Sales Pipeline' });
  const html = await renderHtml(report);

  assert.match(html, /<!doctype html>/);
  assert.match(html, /Sales Pipeline/);
  assert.doesNotMatch(html, /src="http/, 'no external scripts');
  assert.doesNotMatch(html, /href="http/, 'no external stylesheets');
  assert.match(html, /window\.__REPORT__ = \{/);
  assert.match(html, /id="chart-source"/);
  assert.match(html, /id="chart-calls"/);
  assert.match(html, /prefers-color-scheme: dark/, 'dark mode is defined');

  // The embedded JSON must not be able to close the script tag early.
  assert.doesNotMatch(html.split('window.__REPORT__ = ')[1].split('</script>')[0], /<\/script/i);

  const csv = renderCsv(report);
  assert.equal(csv.trim().split('\n').length, 5, 'header plus one row per opportunity');
  assert.match(csv, /calls_inbound,calls_outbound/);
});

test('embedded report json survives a script-closing tag in the data', async (t) => {
  const fixture = makeFixture({ opportunityCount: 1 });
  fixture.opportunities[0].name = 'Evil </script><script>alert(1)</script>';
  t.after(installFetchStub(fixture, { pageSize: 1 }));

  const report = await buildReport(client(), { pipelineName: 'Sales Pipeline' });
  const html = await renderHtml(report);
  const embedded = html.split('window.__REPORT__ = ')[1].split(';</script>')[0];

  assert.doesNotMatch(embedded, /<\/script>/i);
  assert.match(embedded, /\\u003c\\u002fscript\\u003e|\\u003c\/script\\u003e/i);
  assert.equal(JSON.parse(embedded).opportunities[0].opportunityName, 'Evil </script><script>alert(1)</script>');
});
