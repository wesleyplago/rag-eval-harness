import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { decideAbstention } from '../retrieval/abstain.js';
import type { RetrievalResult } from '../retrieval/types.js';

export interface SearchHit extends RetrievalResult {
  sectionPath: string;
  documentSlug: string;
  documentTitle: string;
  content: string;
  isTable: boolean;
}

export interface SearchService {
  search(query: string, k: number): Promise<SearchHit[]>;
  threshold(): number;
  readiness(): { ready: boolean; model: string };
}

const SearchBody = z.object({
  query: z.string().trim().min(2).max(500),
  k: z.coerce.number().int().min(1).max(50).optional(),
});

export interface AppOptions {
  /** Browser origins allowed to call the API (e.g. the portfolio microfrontend). */
  corsOrigins?: string[];
}

export const createApp = (service: SearchService, options: AppOptions = {}): Hono => {
  const app = new Hono();
  const origins = options.corsOrigins ?? [];
  if (origins.length > 0) {
    app.use(
      '*',
      cors({ origin: origins, allowMethods: ['GET', 'POST'], allowHeaders: ['content-type'] }),
    );
  }

  app.get('/health', (context) => {
    const readiness = service.readiness();
    return context.json({
      status: 'ok',
      ready: readiness.ready,
      model: readiness.model,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.post('/search', async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'invalid_json', message: 'Body must be valid JSON.' }, 400);
    }
    const parsed = SearchBody.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          error: 'invalid_body',
          message: 'Body must be {"query": string, "k"?: number}.',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        },
        400,
      );
    }

    const k = parsed.data.k ?? 10;
    const hits = await service.search(parsed.data.query, k);
    const decision = decideAbstention(hits, service.threshold());
    return context.json({
      query: parsed.data.query,
      abstained: !decision.answer,
      reason: decision.reason,
      topScore: decision.topScore,
      results: decision.answer ? hits : [],
    });
  });

  app.notFound((context) => context.json({ error: 'not_found' }, 404));
  app.onError((error, context) => {
    return context.json({ error: 'internal_error', message: error.message }, 500);
  });

  return app;
};
