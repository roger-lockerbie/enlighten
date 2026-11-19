/**
 * Perf-solve (docs/TEST_PLAN.md section 9): how long the radiosity solve takes in Node, from 1,000
 * to 5,000 patches, against the target of 2 s or less per mount at 5,000. Run by hand with
 * `pnpm perf:solve`. The light worker runs the same code, on one thread, as this does.
 */
import { buildGeometry } from '../../src/light/geometry.ts';
import { buildMesh } from '../../src/light/mesh.ts';
import {
  directOnPatches,
  formFactors,
  patchReflectance,
  solve,
} from '../../src/light/radiosity.ts';
import { solveScene } from '../../src/light/response.ts';
import { defaultScene, sixMountScene } from '../../src/light/scene.ts';

const ms = (from: number): string => (performance.now() - from).toFixed(0).padStart(6);

console.log('Six mounts, by patch count:');
console.log('patches  form factors ms  solve ms per mount  total ms per mount');
const six = sixMountScene();
const g = buildGeometry(six);
for (const cap of [1000, 2000, 3000, 4000, 5000]) {
  const mesh = buildMesh(g, cap);
  let t = performance.now();
  const F = formFactors(g, mesh);
  const built = performance.now() - t;
  const rho = patchReflectance(g, mesh);
  t = performance.now();
  for (const e of g.emitters) solve(F, rho, directOnPatches(g, mesh, e));
  const solved = (performance.now() - t) / g.emitters.length;
  console.log(
    `${String(mesh.count).padStart(7)}  ${built.toFixed(0).padStart(15)}  ${solved.toFixed(0).padStart(18)}  ${(built / g.emitters.length + solved).toFixed(0).padStart(18)}`,
  );
}

console.log(
  '\nWhole scenes, as the light worker runs them (mesh, form factors, solves, lightmap):',
);
for (const [name, scene] of [
  ['default, two mounts', defaultScene()],
  ['six mounts', six],
] as const) {
  const t = performance.now();
  const r = solveScene(scene);
  console.log(
    `${name.padEnd(22)} ${ms(t)} ms, ${String(r.patches)} patches, ${(Number(ms(t)) / scene.mounts.length).toFixed(0)} ms per mount`,
  );
}
