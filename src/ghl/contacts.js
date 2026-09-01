import { API_VERSION } from './client.js';

/**
 * Full contact record. The contact embedded in an opportunity search result is
 * a stub without attribution, so lead-source reporting needs this call.
 * Returns null for contacts that have been deleted or are not visible.
 */
export async function fetchContact(client, contactId) {
  const body = await client.get(`/contacts/${encodeURIComponent(contactId)}`, {
    version: API_VERSION.contacts,
    allowStatus: [404],
  });
  if (body?.__status === 404) return null;
  return body.contact ?? null;
}
