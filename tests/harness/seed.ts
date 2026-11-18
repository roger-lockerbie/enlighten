/**
 * A fixed seed for the property tests, when `PROP_SEED` is set. `pnpm coverage` sets it, so the
 * branches the property tests reach, and with them the coverage figures, are the same on every
 * run. `pnpm test:prop` leaves it unset and takes fresh cases each time.
 */
import fc from 'fast-check';

const seed = process.env['PROP_SEED'];
if (seed !== undefined && seed !== '') {
  const value = Number(seed);
  if (!Number.isInteger(value)) throw new Error('PROP_SEED must be a whole number.');
  fc.configureGlobal({ seed: value });
}
