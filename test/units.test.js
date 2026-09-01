import assert from 'node:assert/strict';
import { test } from 'node:test';

import { summariseCalls } from '../src/ghl/calls.js';
import { resolveLeadSource, classifyChannel } from '../src/leadSource.js';
import { aggregate } from '../src/aggregate.js';
import { filterByCreatedAt } from '../src/ghl/opportunities.js';
import { indexSubmissionsByContact } from '../src/ghl/forms.js';
import { renderCsv } from '../src/render/csv.js';

test('summariseCalls counts direction, outcome and duration, ignoring non-calls', () => {
  const summary = summariseCalls([
    { messageType: 'TYPE_CALL', direction: 'inbound', callDuration: 60, callStatus: 'completed', dateAdded: '2026-01-02T00:00:00.000Z' },
    { messageType: 'TYPE_CALL', direction: 'outbound', callDuration: 0, callStatus: 'no-answer', dateAdded: '2026-01-01T00:00:00.000Z' },
    { messageType: 'CALL', direction: 'outbound', callDuration: 30, callStatus: 'completed', dateAdded: '2026-01-03T00:00:00.000Z' },
    { messageType: 'TYPE_SMS', direction: 'inbound', body: 'hi' },
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.inbound, 1);
  assert.equal(summary.outbound, 2);
  assert.equal(summary.answered, 2);
  assert.equal(summary.missed, 1);
  assert.equal(summary.inboundDurationSec, 60);
  assert.equal(summary.outboundDurationSec, 30);
  assert.equal(summary.totalDurationSec, 90);
  assert.equal(summary.firstCallAt, '2026-01-01T00:00:00.000Z');
  assert.equal(summary.lastCallAt, '2026-01-03T00:00:00.000Z');
});

test('summariseCalls treats a call with duration but no status as answered', () => {
  const summary = summariseCalls([{ messageType: 'TYPE_CALL', direction: 'inbound', callDuration: 12 }]);
  assert.equal(summary.answered, 1);
  assert.equal(summary.missed, 0);
});

test('lead source prefers the opportunity source over attribution', () => {
  const resolved = resolveLeadSource(
    { source: 'Inbound Call' },
    { attributionSource: { utmSource: 'facebook' }, source: 'Manual' },
  );
  assert.equal(resolved.source, 'Inbound Call');
  assert.equal(resolved.resolvedFrom, 'opportunity.source');
});

test('lead source falls back through attribution then contact source', () => {
  const viaUtm = resolveLeadSource({ source: '' }, { attributionSource: { utmSource: 'google' } });
  assert.equal(viaUtm.source, 'google');
  assert.equal(viaUtm.resolvedFrom, 'attribution.utmSource');

  const viaSession = resolveLeadSource({}, { attributionSource: { sessionSource: 'Paid Social' } });
  assert.equal(viaSession.source, 'Paid Social');

  const viaReferrer = resolveLeadSource({}, { attributionSource: { referrer: 'https://www.partner.com/x' } });
  assert.equal(viaReferrer.source, 'partner.com');

  const viaContact = resolveLeadSource({}, { source: 'Manual entry' });
  assert.equal(viaContact.source, 'Manual entry');
  assert.equal(viaContact.resolvedFrom, 'contact.source');

  const nothing = resolveLeadSource({}, null);
  assert.equal(nothing.source, 'Unknown');
  assert.equal(nothing.channel, 'Unknown');
});

test('lead source ignores placeholder strings', () => {
  const resolved = resolveLeadSource({ source: '  ' }, { source: 'null' });
  assert.equal(resolved.source, 'Unknown');
});

test('channel classification buckets common sources', () => {
  assert.equal(classifyChannel('facebook', 'cpc'), 'Paid');
  assert.equal(classifyChannel('facebook', 'social'), 'Social');
  assert.equal(classifyChannel('google', 'organic'), 'Search');
  assert.equal(classifyChannel('partner.com', 'referral'), 'Referral');
  assert.equal(classifyChannel('anything', null, { gclid: '123' }), 'Paid');
  assert.equal(classifyChannel('Unknown', null), 'Unknown');
});

test('aggregate rolls totals and groups without double counting', () => {
  const totals = aggregate([
    row({ source: 'A', stage: 'New', status: 'won', inbound: 2, outbound: 1, forms: 1, value: 100 }),
    row({ source: 'A', stage: 'New', status: 'lost', inbound: 0, outbound: 3, forms: 0, value: 50 }),
    row({ source: 'B', stage: 'Contacted', status: 'open', inbound: 1, outbound: 0, forms: 2, value: 25 }),
  ]);

  assert.equal(totals.opportunities, 3);
  assert.equal(totals.calls.inbound, 3);
  assert.equal(totals.calls.outbound, 4);
  assert.equal(totals.calls.total, 7);
  assert.equal(totals.forms.submissions, 3);
  assert.equal(totals.forms.opportunitiesWithSubmission, 2);
  assert.equal(totals.monetaryValue, 175);

  const [a, b] = totals.bySource;
  assert.equal(a.key, 'A');
  assert.equal(a.opportunities, 2);
  assert.equal(a.callsInbound, 2);
  assert.equal(a.winRate, 0.5);
  assert.equal(b.key, 'B');
  assert.equal(b.winRate, null, 'no won/lost deals means no win rate');
});

test('aggregate counts opportunities with no activity at all', () => {
  const totals = aggregate([
    row({ source: 'A', inbound: 0, outbound: 0, forms: 0 }),
    row({ source: 'A', inbound: 1, outbound: 0, forms: 0 }),
  ]);
  assert.equal(totals.opportunitiesWithNoActivity, 1);
  assert.equal(totals.opportunitiesWithCalls, 1);
});

test('date filtering is inclusive and keeps rows with unparseable dates', () => {
  const opportunities = [
    { id: '1', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: '2', createdAt: '2026-06-15T00:00:00.000Z' },
    { id: '3', createdAt: 'not-a-date' },
  ];
  const kept = filterByCreatedAt(opportunities, { start: '2026-02-01', end: '2026-12-31' });
  assert.deepEqual(kept.map((o) => o.id), ['2', '3']);
  assert.equal(filterByCreatedAt(opportunities, {}).length, 3);
});

test('submissions index groups by contact and skips orphans', () => {
  const index = indexSubmissionsByContact([
    { id: 's1', contactId: 'c1' },
    { id: 's2', contact: { id: 'c1' } },
    { id: 's3', contactId: 'c2' },
    { id: 's4' },
  ]);
  assert.equal(index.get('c1').length, 2);
  assert.equal(index.get('c2').length, 1);
  assert.equal(index.size, 2);
});

test('csv quotes separators and defuses formula injection', () => {
  const csv = renderCsv({
    opportunities: [row({ source: '=cmd|calc', name: 'Deal, big "one"' })],
  });
  const [header, line] = csv.trim().split('\n');
  assert.match(header, /^opportunity_id,opportunity_name,/);
  assert.match(line, /"Deal, big ""one"""/);
  assert.match(line, /'=cmd\|calc/);
});

function row({ source = 'A', stage = 'New', status = 'open', inbound = 0, outbound = 0, forms = 0, value = 0, name = 'Deal', contactId = null } = {}) {
  return {
    opportunityId: `opp-${Math.random()}`,
    opportunityName: name,
    stage,
    status,
    monetaryValue: value,
    createdAt: '2026-03-01T00:00:00.000Z',
    contactId: contactId ?? `contact-${Math.random()}`,
    contactName: 'Someone',
    email: null,
    phone: null,
    calls: {
      total: inbound + outbound,
      inbound,
      outbound,
      answered: 0,
      missed: 0,
      totalDurationSec: 0,
      firstCallAt: null,
      lastCallAt: null,
    },
    forms: { submissions: forms, names: [], firstSubmissionAt: null, lastSubmissionAt: null },
    leadSource: {
      source,
      channel: 'Other',
      resolvedFrom: 'opportunity.source',
      firstTouch: { utmSource: null, utmMedium: null, utmCampaign: null, sessionSource: null, referrer: null },
      lastTouch: {},
    },
  };
}

test('a contact with two opportunities is not counted twice for calls or forms', () => {
  const totals = aggregate([
    row({ source: 'A', contactId: 'shared', inbound: 2, outbound: 1, forms: 3, value: 100 }),
    row({ source: 'A', contactId: 'shared', inbound: 2, outbound: 1, forms: 3, value: 200 }),
    row({ source: 'A', contactId: 'other', inbound: 1, outbound: 0, forms: 1, value: 50 }),
  ]);

  assert.equal(totals.opportunities, 3, 'every opportunity still counts as an opportunity');
  assert.equal(totals.monetaryValue, 350, 'value is per opportunity, not per contact');
  assert.equal(totals.contacts, 2);
  assert.equal(totals.duplicateContacts, 1);

  // The shared contact's 2 in / 1 out / 3 forms are counted once, plus the other contact's.
  assert.equal(totals.calls.inbound, 3);
  assert.equal(totals.calls.outbound, 1);
  assert.equal(totals.calls.total, 4);
  assert.equal(totals.forms.submissions, 4);

  const [bucket] = totals.bySource;
  assert.equal(bucket.opportunities, 3);
  assert.equal(bucket.contacts, 2);
  assert.equal(bucket.callsInbound, 3, 'buckets de-duplicate too');
  assert.equal(bucket.formSubmissions, 4);
});

test('the same contact in two different source buckets counts once in each', () => {
  const totals = aggregate([
    row({ source: 'A', contactId: 'shared', inbound: 2, forms: 1 }),
    row({ source: 'B', contactId: 'shared', inbound: 2, forms: 1 }),
  ]);

  assert.equal(totals.calls.inbound, 2, 'headline total counts the contact once');
  assert.equal(totals.bySource.find((b) => b.key === 'A').callsInbound, 2);
  assert.equal(totals.bySource.find((b) => b.key === 'B').callsInbound, 2);
});

test('rows with no contact id never collide with each other', () => {
  const rows = [row({ inbound: 1 }), row({ inbound: 1 })];
  rows.forEach((r) => { r.contactId = null; });
  const totals = aggregate(rows);
  assert.equal(totals.calls.inbound, 2);
  assert.equal(totals.contacts, 0);
});
