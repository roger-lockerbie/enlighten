/**
 * The keys that work in the app outside the console (docs/UI.md section 3), as one table. Settings
 * shows it, and the manual's page of keys is built from it and from the console's binding table.
 * `App.svelte` and the controls handle the keys themselves.
 */
export const APP_KEYS: readonly (readonly [keys: string, does: string])[] = [
  ['Escape, twice within 500 ms', 'Panic, from anywhere, including dialogs'],
  ['Ctrl `', 'Show or hide the console, and move focus to it'],
  ['Alt 1 to Alt 9, Alt 0', 'Go to a page, in the order of the rail. Alt 0 is the tenth'],
  ['F1', 'Open the manual'],
  ['F6, Shift F6', 'Move between regions: top bar, rail, main, inspector, console'],
  ['Tab, Shift Tab', 'Move between controls'],
  ['Left, Right, Up, Down', 'Step a slider or field by one unit'],
  ['Shift with an arrow', 'Step by ten'],
  ['Home, End', "The driver's minimum, and the ceiling"],
  ['Enter', 'Apply, in Commit mode'],
  ['Space, held', 'Hold a dim button'],
];

/** Keys on the Visualiser's picture, when it has focus (docs/UI.md section 3). */
export const PICTURE_KEYS: readonly (readonly [keys: string, does: string])[] = [
  ['W, S', 'Walk forward or back a quarter metre, in the walk view'],
  ['A, D', 'Step left or right a quarter metre, in the walk view'],
  ['Shift with W, A, S, D', 'Step a metre'],
  ['Left, Right, Up, Down', 'Move the probe by 2% of the picture, or 10% with Shift'],
  ['Drag, and the wheel', 'Turn the view, and move in or out'],
];
