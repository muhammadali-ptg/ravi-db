import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { GhlClient, GhlApiError } from './ghl/client.js';
import { listPipelines } from './ghl/pipelines.js';
import { buildReport } from './report.js';
import { renderCsv } from './render/csv.js';
import { renderHtml } from './render/html.js';

const USAGE = `
ghl-report - GoHighLevel pipeline dashboard

Usage:
  ghl-report pipelines                       List pipelines and their ids
  ghl-report report --pipeline "<name>"      Build the dashboard for a pipeline

Options:
  --pipeline <name>     Pipeline name (case-insensitive)
  --pipeline-id <id>    Pipeline id; wins over --pipeline
  --start <date>        Only opportunities created on/after this date (YYYY-MM-DD)
  --end <date>          Only opportunities created on/before this date
  --out <dir>           Output directory (default: ./out)
  --concurrency <n>     Contacts fetched in parallel (default: 4)
  --currency <code>     ISO currency for money formatting (default: USD)
  --no-calls            Skip call data (much faster)
  --no-forms            Skip form submissions
  --no-attribution      Skip per-contact fetch; use opportunity.source only
  --cache               Reuse cached API responses in .cache (default: off)
  --cache-ttl <mins>    Cache lifetime in minutes (default: 360)
  --token <token>       Overrides GHL_API_TOKEN
  --location <id>       Overrides GHL_LOCATION_ID
  --quiet               Suppress progress output
  --help                Show this message

Environment (or a .env file in the working directory):
  GHL_API_TOKEN, GHL_LOCATION_ID, GHL_API_BASE, GHL_PIPELINE_ID
`;

const OPTIONS = {
  pipeline: { type: 'string' },
  'pipeline-id': { type: 'string' },
  start: { type: 'string' },
  end: { type: 'string' },
  out: { type: 'string', default: 'out' },
  concurrency: { type: 'string', default: '4' },
  currency: { type: 'string', default: 'USD' },
  calls: { type: 'boolean', default: true },
  forms: { type: 'boolean', default: true },
  attribution: { type: 'boolean', default: true },
  cache: { type: 'boolean', default: false },
  'cache-ttl': { type: 'string', default: '360' },
  token: { type: 'string' },
  location: { type: 'string' },
  quiet: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
};

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const command = positionals[0] ?? 'report';

  if (values.help || command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  const log = values.quiet ? () => {} : progressLogger();

  const client = new GhlClient({
    token: values.token ?? process.env.GHL_API_TOKEN,
    locationId: values.location ?? process.env.GHL_LOCATION_ID,
    cacheDir: values.cache ? resolve('.cache') : null,
    cacheTtlMs: Number(values['cache-ttl']) * 60 * 1000,
    logger: (message) => log(`  ${message}`),
  });

  if (command === 'pipelines') {
    const pipelines = await listPipelines(client);
    if (pipelines.length === 0) {
      process.stdout.write('No pipelines found on this location.\n');
      return 1;
    }
    for (const pipeline of pipelines) {
      process.stdout.write(`${pipeline.id}  ${pipeline.name}  (${(pipeline.stages ?? []).length} stages)\n`);
    }
    return 0;
  }

  if (command !== 'report') {
    process.stderr.write(`Unknown command "${command}".\n${USAGE}`);
    return 2;
  }

  const pipelineId = values['pipeline-id'] ?? process.env.GHL_PIPELINE_ID;
  if (!pipelineId && !values.pipeline) {
    process.stderr.write('Specify a pipeline with --pipeline "<name>" or --pipeline-id <id>.\nRun `ghl-report pipelines` to list them.\n');
    return 2;
  }

  const report = await buildReport(client, {
    pipelineId,
    pipelineName: values.pipeline,
    start: values.start,
    end: values.end,
    concurrency: Math.max(1, Number(values.concurrency) || 4),
    currency: values.currency,
    includeCalls: values.calls,
    includeForms: values.forms,
    includeAttribution: values.attribution,
    log,
  });

  const outDir = resolve(values.out);
  await mkdir(outDir, { recursive: true });
  const slug = slugify(report.pipeline.name);
  const files = {
    json: join(outDir, `${slug}.json`),
    csv: join(outDir, `${slug}.csv`),
    html: join(outDir, `${slug}.html`),
  };

  await Promise.all([
    writeFile(files.json, JSON.stringify(report, null, 2)),
    writeFile(files.csv, renderCsv(report)),
    renderHtml(report).then((html) => writeFile(files.html, html)),
  ]);

  const t = report.totals;
  log('');
  log(`Inbound calls:     ${t.calls.inbound}`);
  log(`Outbound calls:    ${t.calls.outbound}`);
  log(`Form submissions:  ${t.forms.submissions}`);
  log(`Lead sources:      ${t.bySource.map((b) => `${b.key} (${b.opportunities})`).join(', ') || 'none'}`);
  log('');
  log(`Dashboard:   ${files.html}`);
  log(`Data:        ${files.json}`);
  log(`Spreadsheet: ${files.csv}`);
  return 0;
}

/** Overwrites the current line for progress, so long runs stay on one line. */
function progressLogger() {
  let transientWidth = 0;
  return (message, isProgress = false) => {
    if (transientWidth && process.stderr.isTTY) {
      process.stderr.write('\r' + ' '.repeat(transientWidth) + '\r');
      transientWidth = 0;
    }
    if (isProgress) {
      if (!process.stderr.isTTY) return;
      process.stderr.write(message);
      transientWidth = message.length;
      return;
    }
    process.stderr.write(`${message}\n`);
  };
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pipeline';
}

export function reportError(error) {
  if (error instanceof GhlApiError && error.status === 401) {
    process.stderr.write('Authentication failed (401). Check GHL_API_TOKEN and that it belongs to this location.\n');
  } else if (error instanceof GhlApiError && error.status === 403) {
    process.stderr.write(`Forbidden (403). The token is missing a scope for ${error.path}.\n`);
  } else {
    process.stderr.write(`${error.message}\n`);
  }
}
