/**
 * Roll per-opportunity rows into the numbers the dashboard shows.
 *
 * Calls and form submissions belong to a *contact*, not an opportunity, so a
 * contact with two opportunities in the pipeline would otherwise have their
 * calls counted twice. Opportunity counts and monetary value are summed per
 * opportunity; call and form counts are summed once per distinct contact within
 * each bucket.
 */
export function aggregate(rows) {
  const totals = {
    opportunities: rows.length,
    contacts: new Set(rows.map((r) => r.contactId).filter(Boolean)).size,
    monetaryValue: 0,
    calls: { total: 0, inbound: 0, outbound: 0, answered: 0, missed: 0, durationSec: 0 },
    forms: { submissions: 0, opportunitiesWithSubmission: 0 },
    opportunitiesWithCalls: 0,
    opportunitiesWithNoActivity: 0,
    duplicateContacts: 0,
  };

  const counted = new Set();
  for (const row of rows) {
    totals.monetaryValue += row.monetaryValue;
    if (row.forms.submissions > 0) totals.forms.opportunitiesWithSubmission++;
    if (row.calls.total > 0) totals.opportunitiesWithCalls++;
    if (row.calls.total === 0 && row.forms.submissions === 0) totals.opportunitiesWithNoActivity++;

    if (!firstSighting(counted, row)) {
      totals.duplicateContacts++;
      continue;
    }
    totals.calls.total += row.calls.total;
    totals.calls.inbound += row.calls.inbound;
    totals.calls.outbound += row.calls.outbound;
    totals.calls.answered += row.calls.answered;
    totals.calls.missed += row.calls.missed;
    totals.calls.durationSec += row.calls.totalDurationSec ?? 0;
    totals.forms.submissions += row.forms.submissions;
  }

  return {
    ...totals,
    bySource: groupBy(rows, (r) => r.leadSource.source),
    byChannel: groupBy(rows, (r) => r.leadSource.channel),
    byStage: groupBy(rows, (r) => r.stage),
    byStatus: groupBy(rows, (r) => r.status),
    byMonth: groupBy(rows, (r) => monthOf(r.createdAt)).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** One bucket per distinct key, with the same measures as the headline totals. */
function groupBy(rows, keyOf) {
  const buckets = new Map();
  const countedPerBucket = new Map();

  for (const row of rows) {
    const key = keyOf(row) || 'Unknown';
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        opportunities: 0,
        contacts: 0,
        monetaryValue: 0,
        callsInbound: 0,
        callsOutbound: 0,
        callsTotal: 0,
        formSubmissions: 0,
        won: 0,
        lost: 0,
        open: 0,
      });
      countedPerBucket.set(key, new Set());
    }

    const bucket = buckets.get(key);
    bucket.opportunities++;
    bucket.monetaryValue += row.monetaryValue;
    const status = String(row.status).toLowerCase();
    if (status === 'won') bucket.won++;
    else if (status === 'lost' || status === 'abandoned') bucket.lost++;
    else bucket.open++;

    if (!firstSighting(countedPerBucket.get(key), row)) continue;
    bucket.contacts++;
    bucket.callsInbound += row.calls.inbound;
    bucket.callsOutbound += row.calls.outbound;
    bucket.callsTotal += row.calls.total;
    bucket.formSubmissions += row.forms.submissions;
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      winRate: bucket.won + bucket.lost > 0 ? bucket.won / (bucket.won + bucket.lost) : null,
    }))
    .sort((a, b) => b.opportunities - a.opportunities || a.key.localeCompare(b.key));
}

/**
 * True the first time this contact is seen in the given scope. Rows without a
 * contact id can't collide with anything, so they always count.
 */
function firstSighting(seen, row) {
  if (!row.contactId) return true;
  if (seen.has(row.contactId)) return false;
  seen.add(row.contactId);
  return true;
}

function monthOf(iso) {
  const ts = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 7) : 'Unknown';
}
