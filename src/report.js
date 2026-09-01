import { mapWithConcurrency } from './ghl/client.js';
import { fetchCallMessages, fetchConversations, summariseCalls } from './ghl/calls.js';
import { fetchContact } from './ghl/contacts.js';
import { fetchFormSubmissions, indexSubmissionsByContact } from './ghl/forms.js';
import { fetchPipelineOpportunities, filterByCreatedAt } from './ghl/opportunities.js';
import { resolvePipeline, stageIndex } from './ghl/pipelines.js';
import { resolveLeadSource } from './leadSource.js';
import { aggregate } from './aggregate.js';

const EMPTY_CALLS = {
  total: 0,
  inbound: 0,
  outbound: 0,
  answered: 0,
  missed: 0,
  inboundDurationSec: 0,
  outboundDurationSec: 0,
  totalDurationSec: 0,
  firstCallAt: null,
  lastCallAt: null,
};

/**
 * Build the full report for one pipeline: one row per opportunity, carrying its
 * call counts, form submissions and lead source, plus the rollups on top.
 */
export async function buildReport(client, options) {
  const {
    pipelineId,
    pipelineName,
    start,
    end,
    concurrency = 4,
    currency = 'USD',
    includeCalls = true,
    includeForms = true,
    includeAttribution = true,
    log = () => {},
  } = options;

  const pipeline = await resolvePipeline(client, { id: pipelineId, name: pipelineName });
  const stages = stageIndex(pipeline);
  log(`Pipeline: ${pipeline.name} (${pipeline.id})`);

  const all = await fetchPipelineOpportunities(client, pipeline.id, {
    onProgress: (count, total) => log(`  fetched ${count}${total ? `/${total}` : ''} opportunities`, true),
  });
  const opportunities = filterByCreatedAt(all, { start, end });
  log(`Opportunities: ${opportunities.length}${opportunities.length !== all.length ? ` (of ${all.length} in pipeline)` : ''}`);

  const submissionsByContact = includeForms
    ? indexSubmissionsByContact(
        await fetchFormSubmissions(client, {
          start,
          end,
          onProgress: (count) => log(`  fetched ${count} form submissions`, true),
        }),
      )
    : new Map();
  if (includeForms) log(`Form submissions: ${countValues(submissionsByContact)} across ${submissionsByContact.size} contacts`);

  let done = 0;
  const rows = await mapWithConcurrency(opportunities, concurrency, async (opportunity) => {
    const contactId = opportunity.contactId ?? opportunity.contact?.id ?? null;
    const [contact, calls] = await Promise.all([
      includeAttribution && contactId ? safe(() => fetchContact(client, contactId), null) : null,
      includeCalls && contactId ? safe(() => contactCalls(client, contactId), EMPTY_CALLS) : EMPTY_CALLS,
    ]);
    const row = toRow({ opportunity, contact, calls, stages, submissionsByContact, pipeline });
    log(`  processed ${++done}/${opportunities.length} opportunities`, true);
    return row;
  });
  log(`  processed ${opportunities.length}/${opportunities.length} opportunities`);

  return {
    generatedAt: new Date().toISOString(),
    locationId: client.locationId,
    currency,
    pipeline: { id: pipeline.id, name: pipeline.name, stages: (pipeline.stages ?? []).map((s) => ({ id: s.id, name: s.name })) },
    filters: { start: start ?? null, end: end ?? null, includeCalls, includeForms, includeAttribution },
    stats: { ...client.stats },
    totals: aggregate(rows),
    opportunities: rows,
  };
}

async function contactCalls(client, contactId) {
  const conversations = await fetchConversations(client, contactId);
  const messages = [];
  for (const conversation of conversations) {
    messages.push(...(await fetchCallMessages(client, conversation.id)));
  }
  return summariseCalls(messages);
}

function toRow({ opportunity, contact, calls, stages, submissionsByContact, pipeline }) {
  const contactId = opportunity.contactId ?? opportunity.contact?.id ?? null;
  const submissions = contactId ? (submissionsByContact.get(contactId) ?? []) : [];
  const leadSource = resolveLeadSource(opportunity, contact);

  return {
    opportunityId: opportunity.id,
    opportunityName: opportunity.name ?? '',
    pipelineId: pipeline.id,
    stageId: opportunity.pipelineStageId ?? null,
    stage: stages.get(opportunity.pipelineStageId) ?? 'Unknown stage',
    status: opportunity.status ?? 'unknown',
    monetaryValue: Number(opportunity.monetaryValue) || 0,
    assignedTo: opportunity.assignedTo ?? null,
    createdAt: opportunity.createdAt ?? null,
    updatedAt: opportunity.updatedAt ?? null,
    contactId,
    contactName: contact?.contactName
      ?? opportunity.contact?.name
      ?? [contact?.firstName, contact?.lastName].filter(Boolean).join(' ')
      ?? '',
    email: contact?.email ?? opportunity.contact?.email ?? null,
    phone: contact?.phone ?? opportunity.contact?.phone ?? null,
    calls,
    forms: {
      submissions: submissions.length,
      firstSubmissionAt: earliest(submissions.map((s) => s.createdAt ?? s.dateAdded)),
      lastSubmissionAt: latest(submissions.map((s) => s.createdAt ?? s.dateAdded)),
      names: [...new Set(submissions.map((s) => s.formName ?? s.name ?? s.formId).filter(Boolean))],
    },
    leadSource,
  };
}

/** Never let one bad contact abort a whole report run. */
async function safe(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function countValues(map) {
  let total = 0;
  for (const list of map.values()) total += list.length;
  return total;
}

function earliest(dates) {
  const valid = dates.filter(Boolean).map((d) => Date.parse(d)).filter(Number.isFinite);
  return valid.length ? new Date(Math.min(...valid)).toISOString() : null;
}

function latest(dates) {
  const valid = dates.filter(Boolean).map((d) => Date.parse(d)).filter(Number.isFinite);
  return valid.length ? new Date(Math.max(...valid)).toISOString() : null;
}
