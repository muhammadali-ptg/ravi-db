/** A small in-memory GoHighLevel, enough to exercise the whole report path. */
export function makeFixture({ opportunityCount = 5 } = {}) {
  const sources = ['Facebook Ads', 'Google Ads', 'Referral', 'Website'];
  const stages = [
    { id: 'stage-1', name: 'New Lead' },
    { id: 'stage-2', name: 'Contacted' },
    { id: 'stage-3', name: 'Won' },
  ];

  const opportunities = [];
  const contacts = new Map();
  const conversations = new Map();
  const messages = new Map();
  const submissions = [];

  for (let i = 0; i < opportunityCount; i++) {
    const contactId = `contact-${i}`;
    const stage = stages[i % stages.length];
    opportunities.push({
      id: `opp-${i}`,
      name: `Deal ${i}`,
      pipelineId: 'pipe-1',
      pipelineStageId: stage.id,
      status: i % 3 === 0 ? 'won' : i % 3 === 1 ? 'open' : 'lost',
      monetaryValue: 100 * (i + 1),
      contactId,
      // Half the opportunities carry no source of their own, so the resolver
      // has to fall back to contact attribution.
      source: i % 2 === 0 ? sources[i % sources.length] : '',
      createdAt: `2026-0${(i % 6) + 1}-10T12:00:00.000Z`,
      updatedAt: '2026-08-01T12:00:00.000Z',
      contact: { id: contactId, name: `Contact ${i}` },
    });

    contacts.set(contactId, {
      id: contactId,
      contactName: `Contact ${i}`,
      email: `c${i}@example.com`,
      phone: `+1555000${i}`,
      source: 'Manual entry',
      attributionSource: {
        sessionSource: i % 2 === 0 ? 'Paid Social' : 'Organic Search',
        utmSource: i % 2 === 0 ? 'facebook' : 'google',
        utmMedium: i % 2 === 0 ? 'cpc' : 'organic',
        campaign: `campaign-${i % 2}`,
        referrer: 'https://www.example.com/landing',
      },
    });

    const conversationId = `conv-${i}`;
    conversations.set(contactId, [{ id: conversationId, contactId, type: 'TYPE_PHONE' }]);
    messages.set(conversationId, [
      { id: `m-${i}-a`, messageType: 'TYPE_CALL', direction: 'inbound', callDuration: 90, callStatus: 'completed', dateAdded: '2026-05-01T10:00:00.000Z' },
      { id: `m-${i}-b`, messageType: 'TYPE_CALL', direction: 'outbound', callDuration: 0, callStatus: 'no-answer', dateAdded: '2026-05-02T10:00:00.000Z' },
      { id: `m-${i}-c`, messageType: 'TYPE_CALL', direction: 'outbound', callDuration: 240, callStatus: 'completed', dateAdded: '2026-05-03T10:00:00.000Z' },
      { id: `m-${i}-d`, messageType: 'TYPE_SMS', direction: 'outbound', body: 'not a call', dateAdded: '2026-05-04T10:00:00.000Z' },
    ]);

    submissions.push({ id: `sub-${i}`, contactId, formId: 'form-1', formName: 'Contact Us', createdAt: '2026-04-01T09:00:00.000Z' });
    if (i % 2 === 0) {
      submissions.push({ id: `sub-${i}-b`, contactId, formId: 'form-2', formName: 'Quote Request', createdAt: '2026-04-05T09:00:00.000Z' });
    }
  }

  return { stages, opportunities, contacts, conversations, messages, submissions };
}

/** Installs a fetch stub that serves the fixture. Returns a restore function. */
export function installFetchStub(fixture, { pageSize = 2, calls = [] } = {}) {
  const original = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const query = parsed.searchParams;
    calls.push(`${path}?${query.toString()}`);

    if (path === '/opportunities/pipelines') {
      return json({ pipelines: [{ id: 'pipe-1', name: 'Sales Pipeline', stages: fixture.stages }] });
    }

    if (path === '/opportunities/search') {
      // Cursor pagination, exactly as the real API prefers it.
      const after = query.get('startAfterId');
      const start = after ? fixture.opportunities.findIndex((o) => o.id === after) + 1 : 0;
      const slice = fixture.opportunities.slice(start, start + pageSize);
      const last = slice.at(-1);
      return json({
        opportunities: slice,
        meta: {
          total: fixture.opportunities.length,
          startAfterId: start + slice.length < fixture.opportunities.length ? last?.id : undefined,
          startAfter: last ? Date.parse(last.createdAt) : undefined,
        },
      });
    }

    if (path.startsWith('/contacts/')) {
      const contact = fixture.contacts.get(path.split('/').pop());
      return contact ? json({ contact }) : json({ message: 'not found' }, 404);
    }

    if (path === '/conversations/search') {
      return json({ conversations: fixture.conversations.get(query.get('contactId')) ?? [] });
    }

    if (/^\/conversations\/[^/]+\/messages$/.test(path)) {
      const id = path.split('/')[2];
      const all = fixture.messages.get(id) ?? [];
      const type = query.get('type');
      const filtered = type ? all.filter((m) => m.messageType === type) : all;
      return json({ messages: { messages: filtered, lastMessageId: filtered.at(-1)?.id, nextPage: false } });
    }

    if (path === '/forms/submissions') {
      const page = Number(query.get('page') ?? 1);
      const limit = Number(query.get('limit') ?? 100);
      const slice = fixture.submissions.slice((page - 1) * limit, page * limit);
      return json({ submissions: slice, meta: { total: fixture.submissions.length } });
    }

    return json({ message: `unhandled ${path}` }, 404);
  };

  return () => {
    globalThis.fetch = original;
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
