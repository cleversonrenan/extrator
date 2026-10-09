import assert from 'node:assert/strict';
import { normalizeEndId, validateCorrection } from '../src/index.js';

assert.equal(normalizeEndId('  end-123  '), 'END-123');

const result = validateCorrection('end-123', {
  regiao: '  Grande Rio ',
  subarea: ' Grande Rio  ',
  motivo: ' cadastro incorreto '
});
assert.deepEqual(result.value, {
  endId: 'END-123',
  region: 'Grande Rio',
  subarea: 'Grande Rio',
  reason: 'cadastro incorreto'
});

assert.equal(validateCorrection('*', { regiao: 'A', subarea: 'B' }).error, 'END_ID inválido.');
assert.equal(validateCorrection('END01', { regiao: '', subarea: 'B' }).error, 'Região e subárea são obrigatórias.');

console.log('VALIDADO: normalização e validação das correções.');
