import { expect, test } from 'vitest';
import { createLineDecoder, encode } from '../src/index.js';

test('line decoder reassembles split frames', () => {
  const got: unknown[] = []; const feed = createLineDecoder(m => got.push(m));
  const s = encode({ id: 1, ok: true, result: { a: 1 } });
  feed(s.slice(0, 5)); feed(s.slice(5) + encode({ id: 2, ok: false, error: 'x' }));
  expect(got).toEqual([{ id: 1, ok: true, result: { a: 1 } }, { id: 2, ok: false, error: 'x' }]);
});
