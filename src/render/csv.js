const COLUMNS = [
  ['opportunity_id', (r) => r.opportunityId],
  ['opportunity_name', (r) => r.opportunityName],
  ['stage', (r) => r.stage],
  ['status', (r) => r.status],
  ['monetary_value', (r) => r.monetaryValue],
  ['created_at', (r) => r.createdAt],
  ['contact_id', (r) => r.contactId],
  ['contact_name', (r) => r.contactName],
  ['email', (r) => r.email],
  ['phone', (r) => r.phone],
  ['calls_inbound', (r) => r.calls.inbound],
  ['calls_outbound', (r) => r.calls.outbound],
  ['calls_total', (r) => r.calls.total],
  ['calls_answered', (r) => r.calls.answered],
  ['calls_missed', (r) => r.calls.missed],
  ['call_duration_sec', (r) => r.calls.totalDurationSec],
  ['first_call_at', (r) => r.calls.firstCallAt],
  ['last_call_at', (r) => r.calls.lastCallAt],
  ['form_submissions', (r) => r.forms.submissions],
  ['form_names', (r) => r.forms.names.join(' | ')],
  ['first_submission_at', (r) => r.forms.firstSubmissionAt],
  ['lead_source', (r) => r.leadSource.source],
  ['lead_channel', (r) => r.leadSource.channel],
  ['lead_source_resolved_from', (r) => r.leadSource.resolvedFrom],
  ['utm_source', (r) => r.leadSource.firstTouch.utmSource],
  ['utm_medium', (r) => r.leadSource.firstTouch.utmMedium],
  ['utm_campaign', (r) => r.leadSource.firstTouch.utmCampaign],
  ['session_source', (r) => r.leadSource.firstTouch.sessionSource],
  ['referrer', (r) => r.leadSource.firstTouch.referrer],
];

/** One row per opportunity, for Sheets/Excel. */
export function renderCsv(report) {
  const lines = [COLUMNS.map(([name]) => name).join(',')];
  for (const row of report.opportunities) {
    lines.push(COLUMNS.map(([, get]) => escape(get(row))).join(','));
  }
  return lines.join('\n') + '\n';
}

function escape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Guard against spreadsheet formula injection on text starting with =, +, -, @.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
