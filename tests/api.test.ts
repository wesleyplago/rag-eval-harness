import { describe, expect, it } from 'vitest';
import { createApp, type SearchHit, type SearchService } from '../src/api/server.js';

const fakeService: SearchService = {
  threshold: () => 0.2,
  readiness: () => ({ ready: true, model: 'fake' }),
  async search(query: string, k: number): Promise<SearchHit[]> {
    return [
      {
        chunkId: 42,
        score: 0.9,
        sectionPath: 'CAPÍTULO I',
        documentSlug: 'doc',
        documentTitle: 'Doc',
        content: `resultado para ${query}`,
        isTable: false,
      },
    ].slice(0, k);
  },
};

describe('POST /search', () => {
  it('returns 200 with validated results', async () => {
    const app = createApp(fakeService);
    const response = await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'bloqueio cautelar', k: 5 }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      abstained: boolean;
      results: Array<{ chunkId: number }>;
    };
    expect(body.abstained).toBe(false);
    expect(body.results[0]?.chunkId).toBe(42);
  });

  it('rejects an invalid body with 400', async () => {
    const app = createApp(fakeService);
    const response = await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '' }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_body');
  });

  it('rejects non-JSON with 400', async () => {
    const app = createApp(fakeService);
    const response = await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(response.status).toBe(400);
  });

  it('serves /health', async () => {
    const app = createApp(fakeService);
    const response = await app.request('/health');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; ready: boolean };
    expect(body).toMatchObject({ status: 'ok', ready: true });
  });
});
