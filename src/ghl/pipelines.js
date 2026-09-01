import { API_VERSION } from './client.js';

/** All pipelines for the location, with their stages. */
export async function listPipelines(client) {
  const body = await client.get('/opportunities/pipelines', {
    query: { locationId: client.locationId },
    version: API_VERSION.opportunities,
  });
  return body.pipelines ?? [];
}

/** Resolve a pipeline by id or by (case-insensitive) name. */
export async function resolvePipeline(client, { id, name }) {
  const pipelines = await listPipelines(client);
  if (pipelines.length === 0) {
    throw new Error(`No pipelines found on location ${client.locationId}. Check the token's scopes and location id.`);
  }

  if (id) {
    const match = pipelines.find((p) => p.id === id);
    if (!match) {
      throw new Error(`Pipeline id "${id}" not found. Available: ${describe(pipelines)}`);
    }
    return match;
  }

  const wanted = String(name ?? '').trim().toLowerCase();
  const matches = pipelines.filter((p) => String(p.name ?? '').trim().toLowerCase() === wanted);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Pipeline name "${name}" is ambiguous (${matches.length} matches). Use --pipeline-id instead.`);
  }
  throw new Error(`Pipeline "${name}" not found. Available: ${describe(pipelines)}`);
}

/** Map of stage id -> stage name, for labelling opportunities. */
export function stageIndex(pipeline) {
  const index = new Map();
  for (const stage of pipeline.stages ?? []) index.set(stage.id, stage.name);
  return index;
}

function describe(pipelines) {
  return pipelines.map((p) => `${p.name} (${p.id})`).join(', ');
}
