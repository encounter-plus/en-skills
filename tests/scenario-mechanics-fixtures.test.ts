import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseGame, auditGame } from '../src/core.ts';

const root = new URL('../evals/fixtures/scenario-mechanics/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));

type Schema = { type: string; properties?: Record<string, Schema>; items?: Schema; required?: string[] };
// Deliberately limited to the primitive/object/array definitions in this pinned excerpt.
function validate(value: unknown, schema: Schema): void {
  if (schema.type === 'object') {
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
    const fields = Object.entries(value);
    for (const required of schema.required ?? []) assert.ok(fields.some(([key]) => key === required));
    for (const [key, field] of fields) {
      const property = schema.properties?.[key];
      assert.ok(property, `Unknown wire field: ${key}`);
      validate(field, property);
    }
  } else if (schema.type === 'array') {
    assert.ok(Array.isArray(value));
    assert.ok(schema.items);
    for (const item of value) validate(item, schema.items);
  } else if (schema.type === 'integer') {
    assert.ok(Number.isInteger(value));
  } else {
    assert.ok(['string', 'boolean'].includes(schema.type), `Unsupported schema: ${schema.type}`);
    assert.equal(typeof value, schema.type);
  }
}

test('synthetic ordinary and replacement levels use the real GameDraft parser', () => {
  for (const name of ['ordinary.game.json', 'replacement.game.json']) {
    assert.equal(auditGame(read(name)).findings.length, 0);
  }
  const level = parseGame(read('replacement.game.json')).levels[0];
  assert.equal(level.sectors.length, 13);
  assert.equal(level.requiredSectors, 10);
  const codes = level.sectors.map(sector => sector.answers[0]);
  assert.equal(new Set(codes).size, 13);
  assert.deepEqual(level.helps.map(help => help.text.replace('Код замены: ', '')), codes.slice(10));
  // Both announced paths reach K: all field codes, or eight plus two scheduled replacements.
  assert.equal(codes.slice(0, 10).length, level.requiredSectors);
  assert.equal(new Set([...codes.slice(0, 8), ...codes.slice(10, 12)]).size, level.requiredSectors);
  assert.equal(level.helps[1].afterSeconds, 900);
});

test('new-engine wire examples match the pinned OpenAPI names and types', () => {
  const excerpt = read('openapi-excerpt.json');
  assert.equal(excerpt.swagger, '2.0');
  assert.match(excerpt.upstreamSha256, /^[a-f0-9]{64}$/);
  for (const item of read('effects.requests.json')) {
    const schema = excerpt.definitions[item.schema];
    assert.ok(schema, item.schema);
    validate(item.body, schema);
  }
  const bonus = excerpt.definitions['models.AdminBonusRequest'];
  assert.throws(() => validate({ bonus_time: '7' }, bonus));
  assert.throws(() => validate({ awardMinutes: 7 }, bonus));
  assert.throws(() => validate({ answers: [42] }, bonus));
});

test('same-answer timed reward and information remain separate fixture objects', () => {
  const items = read('effects.requests.json');
  const bonuses = items.filter((item: { schema: string }) => item.schema === 'models.AdminBonusRequest');
  assert.equal(bonuses.length, 2);
  assert.deepEqual(bonuses[0].body.answers, bonuses[1].body.answers);
  assert.equal(bonuses[0].body.has_relative_limit, true);
  assert.equal(bonuses[0].body.life_time_sec, 600);
  assert.equal(bonuses[1].body.has_relative_limit, false);
  assert.ok(bonuses[1].body.bonus_help);
});

test('eval cases have unique IDs and resolve supplied synthetic artifacts', () => {
  const { cases } = JSON.parse(readFileSync(new URL('../evals/cases.json', import.meta.url), 'utf8'));
  assert.equal(new Set(cases.map((item: { id: string }) => item.id)).size, cases.length);
  for (const item of cases) {
    for (const artifact of item.artifacts ?? []) {
      assert.ok(existsSync(new URL(`../${artifact}`, import.meta.url)), artifact);
    }
  }
});
