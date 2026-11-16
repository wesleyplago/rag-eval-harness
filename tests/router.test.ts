import { describe, expect, it } from 'vitest';
import { detectIdentifier } from '../src/retrieval/router.js';

describe('detectIdentifier', () => {
  it('detects a 47-digit linha digitável with separators', () => {
    const linha = '00190.50095 40144.816069 06809.350314 3 37370000000100';
    const detected = detectIdentifier(`Qual o vencimento da linha digitável ${linha}?`);
    expect(detected).toMatchObject({ kind: 'linha-digitavel', mode: 'digits' });
    expect(detected?.value).toHaveLength(47);
  });

  it('detects a 26-35 alphanumeric TXID', () => {
    const detected = detectIdentifier('O que diz o txid 2353c790eefb11eaadc10242ac120002?');
    expect(detected).toMatchObject({ kind: 'txid', mode: 'alphanumeric' });
    expect(detected?.value).toBe('2353C790EEFB11EAADC10242AC120002');
  });

  it('detects a masked CNPJ and a bare CNPJ', () => {
    expect(detectIdentifier('CNPJ 00.038.166/0001-05')).toMatchObject({
      kind: 'cnpj',
      value: '00038166000105',
    });
    expect(detectIdentifier('cnpj 00038166000105')).toMatchObject({ kind: 'cnpj' });
  });

  it('detects nosso número when labelled', () => {
    expect(detectIdentifier('Nosso número: 12345678901')).toMatchObject({
      kind: 'nosso-numero',
      value: '12345678901',
    });
  });

  it('does not fire on ordinary prose or dates', () => {
    expect(detectIdentifier('Como funciona o bloqueio cautelar no Pix?')).toBeNull();
    expect(detectIdentifier('A regra vale desde 12/08/2020.')).toBeNull();
  });
});
