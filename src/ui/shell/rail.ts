/** The pages in the rail, in order. Alt with 1 to 9 goes to the page at that position (docs/UI.md). */
import type { Page } from '../../store/schema.ts';

export const RAIL: readonly { readonly page: Page; readonly label: string }[] = [
  { page: 'playground', label: 'Playground' },
  { page: 'devices', label: 'Devices' },
  { page: 'monitor', label: 'Bus monitor' },
  { page: 'settings', label: 'Settings' },
  { page: 'scripts', label: 'Scripts' },
  { page: 'visualiser', label: 'Visualiser' },
];
