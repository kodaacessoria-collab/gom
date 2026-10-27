import assert from 'node:assert/strict';
import { resolveDeliveryPointSectors } from '../src/lib/deliveryPointSectors.ts';
const sectors = [
  { id: 'boituva_setor_01', operationId: 'boituva', name: 'Setor 01' },
  { id: 'maceio_setor_01', operationId: 'maceio', name: 'Setor 01' },
  { id: 'maceio_setor_02', operationId: 'maceio', name: 'Setor 02' },
];
const points = [
  { id: 'school', operationId: 'maceio', sectorId: 'boituva_setor_01' },
  { id: 'valid', operationId: 'maceio', sectorId: 'maceio_setor_02' },
  { id: 'unknown', operationId: 'maceio', sectorId: 'unknown' },
];
const result = resolveDeliveryPointSectors(points, sectors);
assert.equal(result[0].sectorId, 'maceio_setor_01');
assert.equal(points[0].sectorId, 'boituva_setor_01', 'Não alterar o registro original');
assert.equal(result[1], points[1]);
assert.equal(result[2], points[2]);
assert.equal(resolveDeliveryPointSectors(points, sectors.slice(1))[0].sectorId, 'maceio_setor_01');
assert.equal(resolveDeliveryPointSectors(points, [...sectors, { id: 'duplicate', operationId: 'maceio', name: 'Setor 01' }])[0], points[0]);
console.log('OK: setores antigos de outra operação, vínculos válidos e ambiguidades.');
