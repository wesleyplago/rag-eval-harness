import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp, type SearchHit, type SearchService } from '../api/server.js';
import { config } from '../config.js';
import { getChunksByIds } from '../db/queries.js';
import { logger } from '../logger.js';
import { HybridRetriever } from '../retrieval/hybrid.js';

const readThreshold = async (): Promise<number> => {
  try {
    const raw = await readFile(join(process.cwd(), 'config', 'abstention.json'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed.hybrid ?? config.ABSTAIN_THRESHOLD;
  } catch {
    return config.ABSTAIN_THRESHOLD;
  }
};

const boot = async (): Promise<void> => {
  const retriever = new HybridRetriever('local:bge-m3');
  const threshold = await readThreshold();
  let ready = false;

  const service: SearchService = {
    threshold: () => threshold,
    readiness: () => ({ ready, model: 'local:bge-m3' }),
    async search(query: string, k: number): Promise<SearchHit[]> {
      const results = await retriever.retrieve(query, k);
      const chunks = await getChunksByIds(results.map((result) => result.chunkId));
      const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
      return results.flatMap((result) => {
        const chunk = byId.get(result.chunkId);
        if (!chunk) return [];
        return [
          {
            chunkId: chunk.id,
            score: result.score,
            sectionPath: chunk.sectionPath,
            documentSlug: chunk.documentSlug,
            documentTitle: chunk.documentTitle,
            content: chunk.content,
            isTable: chunk.isTable,
          },
        ];
      });
    },
  };

  // Warm the embedding model so the first /search is not a 20s surprise.
  try {
    await retriever.retrieve('aquecimento do modelo de embeddings', 1);
    ready = true;
  } catch (error: unknown) {
    logger.error('model warmup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const app = createApp(service);
  serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    logger.info('api listening', { port: info.port, ready });
  });
};

boot().catch((error: unknown) => {
  logger.error('api failed to start', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
