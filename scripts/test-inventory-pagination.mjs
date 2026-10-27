import assert from 'node:assert/strict';
import { readAllRows } from '../src/lib/readAllRows.ts';

for (const count of [0, 1, 499, 500, 1000, 1203]) {
  const inventory = Array.from({ length: count }, (_, id) => ({ id, quantity: id + 1 }));
  const calls = [];
  const result = await readAllRows(async (first, last) => {
    calls.push([first, last]);
    return { data: inventory.slice(first, last + 1), error: null };
  });
  assert.deepEqual(result, inventory, `Todos os ${count} lotes devem ser carregados`);
  assert.equal(calls.length, Math.floor(count / 500) + 1);
}
const failure = new Error('Falha na segunda página');
await assert.rejects(() => readAllRows(async first => first === 0
  ? { data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null }
  : { data: null, error: failure }), error => error === failure);
console.log('OK: estoque acima de 1.000 registros, páginas exatas e falhas sem retornar estoque parcial.');
