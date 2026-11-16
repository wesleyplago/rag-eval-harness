import { resolve } from 'node:path';
import { env, type FeatureExtractionPipeline, pipeline } from '@huggingface/transformers';
import { config } from '../config.js';
import { ProviderError } from '../errors.js';
import { logger } from '../logger.js';

env.cacheDir = resolve(config.EMBEDDING_CACHE_DIR);
env.allowLocalModels = true;
env.useBrowserCache = false;

let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

const getExtractor = async (): Promise<FeatureExtractionPipeline> => {
  if (!extractorPromise) {
    const started = Date.now();
    logger.info('loading embedding model', { model: config.EMBEDDING_MODEL });
    extractorPromise = pipeline('feature-extraction', config.EMBEDDING_MODEL, {
      dtype: 'q8',
    }) as Promise<FeatureExtractionPipeline>;
    extractorPromise.catch(() => {
      extractorPromise = undefined;
    });
    const extractor = await extractorPromise;
    logger.info('embedding model ready', { ms: Date.now() - started });
    return extractor;
  }
  return extractorPromise;
};

export const embedTexts = async (texts: string[]): Promise<number[][]> => {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: 'cls', normalize: true });
  const vectors = output.tolist() as number[][];
  return vectors.map((vector) => {
    if (vector.length !== config.EMBEDDING_DIM) {
      throw new ProviderError(
        'embeddings',
        `expected ${config.EMBEDDING_DIM} dimensions, got ${vector.length}`,
      );
    }
    return vector;
  });
};

export const embedQuery = async (query: string): Promise<number[]> => {
  const [vector] = await embedTexts([query]);
  if (!vector) throw new ProviderError('embeddings', 'empty embedding');
  return vector;
};
