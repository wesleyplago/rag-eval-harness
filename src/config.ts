import 'dotenv/config';
import { z } from 'zod';

const optionalUrl = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1).default('postgres://rag:rag@localhost:5433/rag'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  EMBEDDING_PROVIDER: z.literal('local').default('local'),
  EMBEDDING_MODEL: z.string().min(1).default('Xenova/bge-m3'),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1024),
  EMBEDDING_CACHE_DIR: z.string().min(1).default('./.cache/transformers'),

  RERANK_BASE_URL: optionalUrl,
  RERANK_API_KEY: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim())),
  RERANK_MODEL: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim())),
  RERANK_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  RERANK_CANDIDATES: z.coerce.number().int().min(10).max(100).default(50),

  TOP_K: z.coerce.number().int().min(1).max(50).default(10),
  RRF_K: z.coerce.number().int().min(1).max(200).default(60),
  // Fallback only; per-config thresholds come from config/abstention.json. 0 = never abstain.
  ABSTAIN_THRESHOLD: z.coerce.number().min(0).max(1).default(0),
});

export type Config = z.infer<typeof EnvSchema> & {
  rerank: {
    enabled: boolean;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    timeoutMs: number;
    candidates: number;
  };
};

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
}

const env = parsed.data;

if (env.EMBEDDING_DIM !== 1024) {
  throw new Error(
    `EMBEDDING_DIM must be 1024: migration 0001 declares vector(1024), matching bge-m3. Got ${env.EMBEDDING_DIM}.`,
  );
}

export const config: Config = {
  ...env,
  rerank: {
    enabled: Boolean(env.RERANK_BASE_URL && env.RERANK_MODEL),
    baseUrl: env.RERANK_BASE_URL,
    apiKey: env.RERANK_API_KEY,
    model: env.RERANK_MODEL,
    timeoutMs: env.RERANK_TIMEOUT_MS,
    candidates: env.RERANK_CANDIDATES,
  },
};
