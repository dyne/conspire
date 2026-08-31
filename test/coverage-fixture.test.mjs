import test from 'node:test';
import assert from 'node:assert/strict';
import { coveredFixturePath } from '../front/chat/coverage-fixture.js';

test('coverage fixture leaves one branch intentionally unexecuted', () => {
  assert.equal(coveredFixturePath(), 'covered');
});
