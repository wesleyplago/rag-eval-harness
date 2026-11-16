export class HarnessError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class IngestError extends HarnessError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('INGEST_ERROR', message, options);
  }
}

export class RetrievalError extends HarnessError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('RETRIEVAL_ERROR', message, options);
  }
}

export class RerankError extends HarnessError {
  readonly retryable: boolean;
  constructor(message: string, options?: { cause?: unknown; retryable?: boolean }) {
    super('RERANK_ERROR', message, options);
    this.retryable = options?.retryable ?? true;
  }
}

export class ProviderError extends HarnessError {
  constructor(provider: string, message: string, options?: { cause?: unknown }) {
    super('PROVIDER_ERROR', `${provider}: ${message}`, options);
  }
}
