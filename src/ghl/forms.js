import { API_VERSION } from './client.js';

const PAGE_SIZE = 100;

/**
 * Every form submission on the location, optionally narrowed to a date window.
 *
 * The location-wide submissions endpoint is one call per 100 submissions, which
 * is far cheaper than asking per contact. Some sub-accounts reject it without a
 * formId, so this falls back to walking each form in turn.
 */
export async function fetchFormSubmissions(client, { start, end, onProgress = () => {} } = {}) {
  try {
    return await paginateSubmissions(client, { start, end, onProgress });
  } catch (error) {
    if (![400, 401, 403, 422].includes(error.status)) throw error;
    const forms = await listForms(client);
    const all = [];
    for (const form of forms) {
      const rows = await paginateSubmissions(client, { start, end, formId: form.id, onProgress: () => onProgress(all.length) });
      all.push(...rows);
      onProgress(all.length);
    }
    return all;
  }
}

async function paginateSubmissions(client, { start, end, formId, onProgress }) {
  const submissions = [];
  const seen = new Set();
  for (let page = 1; ; page++) {
    const body = await client.get('/forms/submissions', {
      query: {
        locationId: client.locationId,
        formId,
        limit: PAGE_SIZE,
        page,
        startAt: toDateOnly(start),
        endAt: toDateOnly(end),
      },
      version: API_VERSION.forms,
    });
    const batch = body.submissions ?? [];
    for (const submission of batch) {
      const key = submission.id ?? JSON.stringify(submission);
      if (seen.has(key)) continue;
      seen.add(key);
      submissions.push(submission);
    }
    onProgress(submissions.length);
    if (batch.length < PAGE_SIZE) break;
    const total = body.meta?.total;
    if (total && submissions.length >= total) break;
  }
  return submissions;
}

async function listForms(client) {
  const body = await client.get('/forms', {
    query: { locationId: client.locationId, limit: PAGE_SIZE },
    version: API_VERSION.forms,
  });
  return body.forms ?? [];
}

/** Group submissions by contact id so they can be joined onto opportunities. */
export function indexSubmissionsByContact(submissions) {
  const index = new Map();
  for (const submission of submissions) {
    const contactId = submission.contactId ?? submission.contact?.id;
    if (!contactId) continue;
    if (!index.has(contactId)) index.set(contactId, []);
    index.get(contactId).push(submission);
  }
  return index;
}

/** HighLevel expects YYYY-MM-DD on the submissions date filters. */
function toDateOnly(value) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}
