#!/usr/bin/env node
// Renders a dashboard from synthetic data so the layout can be reviewed
// without GoHighLevel credentials: `node scripts/demo.js`
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { GhlClient } from '../src/ghl/client.js';
import { buildReport } from '../src/report.js';
import { renderHtml } from '../src/render/html.js';
import { renderCsv } from '../src/render/csv.js';
import { installFetchStub, makeFixture } from '../test/fixtures.js';

const SOURCES = ['Facebook Ads', 'Google Ads', 'Website Form', 'Referral', 'Cold Outreach', 'Yelp'];
const WEIGHTS = [0.3, 0.24, 0.18, 0.13, 0.09, 0.06];

// A fixed seed keeps the preview stable between runs.
let seed = 42;
function random() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

function pickSource() {
  let roll = random();
  for (let i = 0; i < SOURCES.length; i++) {
    roll -= WEIGHTS[i];
    if (roll <= 0) return SOURCES[i];
  }
  return SOURCES.at(-1);
}

const fixture = makeFixture({ opportunityCount: 60 });
for (const opportunity of fixture.opportunities) {
  opportunity.source = pickSource();
  opportunity.monetaryValue = Math.round(random() * 9000) + 500;
  const roll = random();
  opportunity.status = roll < 0.2 ? 'won' : roll < 0.35 ? 'lost' : 'open';
  // Vary call volume so the bars are not all identical.
  const conversationId = `conv-${opportunity.id.split('-')[1]}`;
  const messages = fixture.messages.get(conversationId) ?? [];
  fixture.messages.set(conversationId, messages.slice(0, 1 + Math.floor(random() * messages.length)));
}

const restore = installFetchStub(fixture, { pageSize: 20 });
try {
  const client = new GhlClient({ token: 'demo', locationId: 'demo-location', baseUrl: 'https://ghl.demo' });
  const report = await buildReport(client, { pipelineName: 'Sales Pipeline', log: () => {} });
  const out = resolve('out');
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'demo.html'), await renderHtml(report));
  await writeFile(resolve(out, 'demo.csv'), renderCsv(report));
  process.stdout.write(`Wrote ${resolve(out, 'demo.html')}\n`);
} finally {
  restore();
}
