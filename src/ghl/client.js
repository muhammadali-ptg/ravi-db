import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_BASE = 'https://services.leadconnectorhq.com';

/**
 * HighLevel versions each API group separately and rejects requests that send
 * the wrong one, so the header is chosen per endpoint rather than globally.
 */
export const API_VERSION = {
  contacts: '2021-07-28',
  conversations: '2021-04-15',
  forms: '2021-07-28',
  opportunities: '2021-07-28',
};

export class GhlApiError extends Error {
  constructor(status, path, body) {
    super(`GHL API ${status} on ${path}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.name = 'GhlApiError';
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

/**
 * Token bucket matching HighLevel's burst limit of 100 requests per 10 seconds
 * per location. Requests queue rather than fail so a large pipeline can be
 * walked without babysitting.
 */
class RateLimiter {
  #capacity;
  #windowMs;
  #hits = [];

  constructor({ capacity = 90, windowMs = 10_000 } = {}) {
    this.#capacity = capacity;
    this.#windowMs = windowMs;
  }

  async take() {
    for (;;) {
      const now = Date.now();
      this.#hits = this.#hits.filter((t) => now - t < this.#windowMs);
      if (this.#hits.length < this.#capacity) {
        this.#hits.push(now);
        return;
      }
      const waitMs = this.#windowMs - (now - this.#hits[0]) + 5;
      await sleep(waitMs);
    }
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs tasks with a bounded number in flight, preserving result order. */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export class GhlClient {
  constructor({
    token,
    locationId,
    baseUrl = process.env.GHL_API_BASE || DEFAULT_BASE,
    cacheDir = null,
    cacheTtlMs = 6 * 60 * 60 * 1000,
    maxRetries = 4,
    logger = () => {},
  } = {}) {
    if (!token) throw new Error('Missing GHL API token. Set GHL_API_TOKEN or pass --token.');
    if (!locationId) throw new Error('Missing location id. Set GHL_LOCATION_ID or pass --location.');
    this.token = token;
    this.locationId = locationId;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.cacheDir = cacheDir;
    this.cacheTtlMs = cacheTtlMs;
    this.maxRetries = maxRetries;
    this.logger = logger;
    this.limiter = new RateLimiter();
    this.stats = { requests: 0, cacheHits: 0, retries: 0 };
  }

  #url(path, query = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  #cachePath(url) {
    const key = createHash('sha256').update(url.toString()).digest('hex').slice(0, 32);
    return join(this.cacheDir, `${key}.json`);
  }

  async #readCache(url) {
    if (!this.cacheDir) return null;
    try {
      const raw = await readFile(this.#cachePath(url), 'utf8');
      const entry = JSON.parse(raw);
      if (Date.now() - entry.cachedAt > this.cacheTtlMs) return null;
      this.stats.cacheHits++;
      return entry.body;
    } catch {
      return null;
    }
  }

  async #writeCache(url, body) {
    if (!this.cacheDir) return;
    const file = this.#cachePath(url);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ url: url.toString(), cachedAt: Date.now(), body }));
  }

  /**
   * GET a HighLevel endpoint. Retries on 429 and 5xx with exponential backoff,
   * honouring Retry-After when the API sends it.
   */
  async get(path, { query = {}, version = API_VERSION.opportunities, allowStatus = [] } = {}) {
    const url = this.#url(path, query);
    const cached = await this.#readCache(url);
    if (cached) return cached;

    let attempt = 0;
    for (;;) {
      await this.limiter.take();
      this.stats.requests++;
      let response;
      try {
        response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Version: version,
            Accept: 'application/json',
          },
        });
      } catch (cause) {
        if (attempt >= this.maxRetries) throw new Error(`Network failure on ${path}: ${cause.message}`, { cause });
        await this.#backoff(++attempt, null, path);
        continue;
      }

      if (response.ok) {
        const body = await response.json();
        await this.#writeCache(url, body);
        return body;
      }

      const text = await response.text();
      const body = safeJson(text);

      if (allowStatus.includes(response.status)) return { __status: response.status, __body: body };

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        await this.#backoff(++attempt, response.headers.get('retry-after'), path);
        continue;
      }
      throw new GhlApiError(response.status, path, body);
    }
  }

  async #backoff(attempt, retryAfter, path) {
    this.stats.retries++;
    const headerMs = retryAfter ? Number(retryAfter) * 1000 : 0;
    const waitMs = Number.isFinite(headerMs) && headerMs > 0
      ? headerMs
      : Math.min(30_000, 2 ** attempt * 500) + Math.floor(Math.random() * 250);
    this.logger(`retrying ${path} in ${waitMs}ms (attempt ${attempt}/${this.maxRetries})`);
    await sleep(waitMs);
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
