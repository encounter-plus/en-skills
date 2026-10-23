import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecalculationService } from '../src/recalculation.js';
import { FixtureApi, gameId, levelId, units } from '../../tests/recalculation-fixture.js';

test('MCP evidence/calculate/propose cannot grant itself approval; session-bound references reject a new account', async () => {
  const api = new FixtureApi(), root = await mkdtemp(join(tmpdir(), 'recalc-mcp-'));
  const service = new RecalculationService('synthetic', root, api.client());
  const evidence = await service.read(Number(gameId), Number(levelId));
  const inspected = await service.inspect(evidence.evidenceRef, 'events'); assert.equal(inspected.items.length, 10);
  const calculation = await service.calculate(evidence.evidenceRef, { id: 'synthetic-destroyed', reason: 'Уничтожен код', type: 'destroyed-code',
    units, required: 5, destroyedUnitId: '1', choice: 'reduce-required-by-one' });
  assert.equal(calculation.status, 'complete');
  const plan = await service.propose(calculation.calculationRef); assert.equal(plan.operations, 1); assert.equal(plan.applied, false);
  await assert.rejects(service.apply(plan.planRef), /Human confirmation|writes disabled/); assert.equal(api.writes, 0);
  api.token = 'synthetic-other-account';
  await assert.rejects(service.inspect(evidence.evidenceRef, 'events'), /changed/);
});
