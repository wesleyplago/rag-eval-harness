import { encode } from 'gpt-tokenizer';

/**
 * Token counts drive the 700-1000 token chunk budget. We use cl100k_base as a
 * stable, offline proxy for the embedding model tokenizer (XLM-R). The ADR
 * notes the difference; chunk sizes are not sensitive to a ~10% delta.
 */
export const countTokens = (text: string): number => encode(text).length;
