import { API_VERSION } from './client.js';

const PAGE_SIZE = 100;

/**
 * Every opportunity in a pipeline.
 *
 * Pagination follows meta.startAfter/startAfterId when HighLevel returns them
 * (page-number paging is capped server-side on large result sets) and falls
 * back to incrementing `page` otherwise.
 */
export async function fetchPipelineOpportunities(client, pipelineId, { onProgress = () => {} } = {}) {
  const opportunities = [];
  const seen = new Set();
  let page = 1;
  let startAfter;
  let startAfterId;

  for (;;) {
    const body = await client.get('/opportunities/search', {
      query: {
        location_id: client.locationId,
        pipeline_id: pipelineId,
        limit: PAGE_SIZE,
        page: startAfterId ? undefined : page,
        startAfter,
        startAfterId,
      },
      version: API_VERSION.opportunities,
    });

    const batch = body.opportunities ?? [];
    let added = 0;
    for (const opportunity of batch) {
      if (seen.has(opportunity.id)) continue;
      seen.add(opportunity.id);
      opportunities.push(opportunity);
      added++;
    }
    onProgress(opportunities.length, body.meta?.total);

    // Stop on a short page, on a page that was entirely duplicates (which means
    // the cursor stopped advancing), or when the cursor runs out.
    if (batch.length === 0 || added === 0) break;
    const meta = body.meta ?? {};
    if (meta.startAfterId && meta.startAfterId !== startAfterId) {
      startAfter = meta.startAfter;
      startAfterId = meta.startAfterId;
    } else if (batch.length < PAGE_SIZE) {
      break;
    } else {
      page++;
    }
    if (meta.total && opportunities.length >= meta.total) break;
  }

  return opportunities;
}

/** Keep only opportunities created inside [start, end] (either side optional). */
export function filterByCreatedAt(opportunities, { start, end }) {
  if (!start && !end) return opportunities;
  const from = start ? Date.parse(start) : Number.NEGATIVE_INFINITY;
  const to = end ? Date.parse(end) : Number.POSITIVE_INFINITY;
  return opportunities.filter((opportunity) => {
    const created = Date.parse(opportunity.createdAt ?? '');
    if (!Number.isFinite(created)) return true;
    return created >= from && created <= to;
  });
}
