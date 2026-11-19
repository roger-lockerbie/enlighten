/**
 * Sizes and versions shared by the solver and by the code that checks what the solver gave. They
 * live apart so that checking a stored response does not pull the solver in with it.
 */

/** Raised whenever a change to the solver would change its answers, so old cache entries are not reused. */
export const SOLVER_VERSION = 1;

/** The dense form factor matrix grows with the square of this (100 MB at 5,000). */
export const MAX_PATCHES = 5000;

/** The lightmap's size in texels. */
export const ATLAS_WIDTH = 256;
export const MAX_ATLAS_HEIGHT = 1024;
