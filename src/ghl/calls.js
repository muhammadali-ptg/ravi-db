import { API_VERSION } from './client.js';

const PAGE_SIZE = 100;
const CALL_TYPES = new Set(['TYPE_CALL', 'CALL']);
const ANSWERED = new Set(['completed', 'answered']);
const MISSED = new Set(['no-answer', 'noanswer', 'busy', 'failed', 'canceled', 'cancelled', 'voicemail']);

/** Conversations belonging to one contact. */
export async function fetchConversations(client, contactId) {
  const body = await client.get('/conversations/search', {
    query: { locationId: client.locationId, contactId, limit: PAGE_SIZE },
    version: API_VERSION.conversations,
  });
  return body.conversations ?? [];
}

/**
 * All messages in a conversation.
 *
 * Asks HighLevel for call messages only; sub-accounts that reject the `type`
 * filter fall back to fetching everything and filtering here.
 */
export async function fetchCallMessages(client, conversationId) {
  try {
    return await paginateMessages(client, conversationId, 'TYPE_CALL');
  } catch (error) {
    if (![400, 422].includes(error.status)) throw error;
    const all = await paginateMessages(client, conversationId, undefined);
    return all.filter(isCallMessage);
  }
}

async function paginateMessages(client, conversationId, type) {
  const messages = [];
  const seen = new Set();
  let lastMessageId;

  for (;;) {
    const body = await client.get(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
      query: { limit: PAGE_SIZE, lastMessageId, type },
      version: API_VERSION.conversations,
    });

    // The endpoint nests the page under `messages`, but has also been observed
    // returning a bare array; accept either.
    const page = Array.isArray(body.messages) ? { messages: body.messages } : (body.messages ?? {});
    const batch = page.messages ?? [];
    let added = 0;
    for (const message of batch) {
      if (message.id && seen.has(message.id)) continue;
      if (message.id) seen.add(message.id);
      messages.push(message);
      added++;
    }

    const nextId = page.lastMessageId ?? batch.at(-1)?.id;
    if (!page.nextPage || batch.length === 0 || added === 0 || !nextId || nextId === lastMessageId) break;
    lastMessageId = nextId;
  }

  return messages;
}

function isCallMessage(message) {
  return CALL_TYPES.has(String(message.messageType ?? '').toUpperCase());
}

/** Roll a contact's call messages into the counters the dashboard reports. */
export function summariseCalls(messages) {
  const summary = {
    total: 0,
    inbound: 0,
    outbound: 0,
    answered: 0,
    missed: 0,
    inboundDurationSec: 0,
    outboundDurationSec: 0,
    firstCallAt: null,
    lastCallAt: null,
  };

  for (const message of messages) {
    if (!isCallMessage(message)) continue;
    summary.total++;

    const direction = String(message.direction ?? '').toLowerCase();
    const duration = Number(message.callDuration) || 0;
    if (direction === 'inbound') {
      summary.inbound++;
      summary.inboundDurationSec += duration;
    } else if (direction === 'outbound') {
      summary.outbound++;
      summary.outboundDurationSec += duration;
    }

    const status = String(message.callStatus ?? '').toLowerCase();
    if (ANSWERED.has(status)) summary.answered++;
    else if (MISSED.has(status)) summary.missed++;
    else if (duration > 0) summary.answered++;

    const at = message.dateAdded ?? message.dateUpdated;
    const ts = at ? Date.parse(at) : NaN;
    if (Number.isFinite(ts)) {
      const iso = new Date(ts).toISOString();
      if (!summary.firstCallAt || iso < summary.firstCallAt) summary.firstCallAt = iso;
      if (!summary.lastCallAt || iso > summary.lastCallAt) summary.lastCallAt = iso;
    }
  }

  summary.totalDurationSec = summary.inboundDurationSec + summary.outboundDurationSec;
  return summary;
}
