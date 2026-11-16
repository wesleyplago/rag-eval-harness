export type IdentifierKind = 'linha-digitavel' | 'cnpj' | 'txid' | 'nosso-numero';

export interface DetectedIdentifier {
  kind: IdentifierKind;
  /** Normalized value: digits only, or uppercase alphanumerics for TXID. */
  value: string;
  mode: 'digits' | 'alphanumeric';
}

const digitsOnly = (value: string): string => value.replace(/\D/g, '');

const detectLinhaDigitavel = (query: string): string | null => {
  const candidates = query.match(/(?:\d[\s.-]?){47,48}/g) ?? [];
  for (const candidate of candidates) {
    const digits = digitsOnly(candidate);
    if (digits.length === 47 || digits.length === 48) return digits;
  }
  return null;
};

const detectCnpj = (query: string): string | null => {
  const masked = query.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/);
  if (masked) return digitsOnly(masked[0]);
  const bare = query.match(/(?<!\d)\d{14}(?!\d)/);
  return bare ? bare[0] : null;
};

const detectTxid = (query: string): string | null => {
  const candidates = query.match(/\b[A-Za-z0-9]{26,35}\b/g) ?? [];
  for (const candidate of candidates) {
    if (/[A-Za-z]/.test(candidate) && /\d/.test(candidate)) return candidate.toUpperCase();
  }
  return null;
};

const detectNossoNumero = (query: string): string | null => {
  const labeled = query.match(/\bnosso\s+n[uú]mero\b[^\d]{0,30}([\d.\-/]{9,20})/i);
  if (labeled?.[1]) {
    const digits = digitsOnly(labeled[1]);
    if (digits.length >= 9 && digits.length <= 14) return digits;
  }
  return null;
};

/**
 * Identifier detection runs before ANN. Order matters: the 47/48-digit linha
 * digitável also contains shorter numeric runs, and a CNPJ can appear inside a
 * TXID-like string only by accident, so we check the most specific pattern first.
 */
export const detectIdentifier = (query: string): DetectedIdentifier | null => {
  const linha = detectLinhaDigitavel(query);
  if (linha) return { kind: 'linha-digitavel', value: linha, mode: 'digits' };

  const cnpj = detectCnpj(query);
  if (cnpj) return { kind: 'cnpj', value: cnpj, mode: 'digits' };

  const txid = detectTxid(query);
  if (txid) return { kind: 'txid', value: txid, mode: 'alphanumeric' };

  const nossoNumero = detectNossoNumero(query);
  if (nossoNumero) return { kind: 'nosso-numero', value: nossoNumero, mode: 'digits' };

  return null;
};

export const formatIdentifier = (identifier: DetectedIdentifier): string => {
  if (identifier.kind === 'cnpj') {
    const value = identifier.value;
    return `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`;
  }
  if (identifier.kind === 'linha-digitavel') {
    return identifier.value.replace(/(.{5})/g, '$1 ').trim();
  }
  return identifier.value;
};
