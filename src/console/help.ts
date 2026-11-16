/**
 * Console help (SPEC section 6): `help` lists the commands, `help <command>` explains one, and
 * `help keys` prints the binding table as it applies on this platform (ADR 0006).
 */
import { legend, type Platform } from './keys.ts';

const TOPICS: Readonly<Record<string, readonly string[]>> = {
  level: [
    'level <addr> <value> [fade <time>]',
    'Sets the level. 35% is output, a bare number is an arc level 0 to 254. A fade is set first.',
    'The governor holds every level to the ceiling.',
  ],
  off: ['off <addr>', 'Turns the address off (OFF).'],
  on: ['on <addr>', 'Goes back to the last level it had (GO TO LAST ACTIVE LEVEL).'],
  tc: [
    'tc <addr> <temperature> [<value>]',
    'Colour temperature, as 2700K or 370m, with an optional level in the same fade.',
  ],
  rgb: [
    'rgb <addr> <r> <g> <b> [w <n>] [a <n>]   or   rgb <addr> #rrggbb [w <n>] [a <n>]',
    'Channel levels 0 to 254. w is the first white, a the second. Whites not given are off.',
  ],
  fade: [
    'fade <addr>   fade <addr> <time>   fade <addr> rate <n>',
    'Shows the fade, or sets the nearest fade time the driver has and says which. A rate is 1 to 15.',
  ],
  scene: [
    'scene <addr> recall <n>   scene <addr> store <n> [<value>]   scene <addr> remove <n>   scene <addr> list',
    'Scenes 0 to 15. store keeps the present level, or the one given, and reads it back.',
  ],
  group: ['group <addr> add <n>   group <addr> remove <n>', 'Group membership, 0 to 15.'],
  query: [
    'query <addr> [<what>]',
    'One value, or a summary. <what> is level, max, min, phm, power-on, failure, type, fade, groups, tc,',
    'or any query command without "query-", such as actual-level or status.',
  ],
  devices: ['devices', 'Lists the inventory.'],
  scan: ['scan', 'Scans the bus again and writes the safety profile.'],
  profile: [
    'profile [<addr>]   profile apply',
    "Shows the safety profile's state, or writes it again.",
  ],
  cap: [
    'cap [<value>]',
    'Shows or sets the ceiling, as 40% or an arc level. Lowering takes effect at once.',
    'Raising asks you to type the new value. A script cannot raise it.',
  ],
  target: [
    'target [sim | hw | both]',
    'Shows or sets the output target. Changing it stops scripts.',
  ],
  trace: ['trace [on | off]', 'Shows every frame in the console as it is sent.'],
  panic: ['panic', 'Stops everything and turns every light off. Escape twice does the same.'],
  resume: ['resume', 'Releases the panic latch. Nothing is sent by resuming.'],
  unlock: ['unlock rate | reset | expert', 'A session unlock. You type its name to confirm.'],
  lock: ['lock [<name>]', 'Drops one unlock, or all of them.'],
  run: [
    'run <script>',
    'Runs a script. Enter continues at a pause. Ctrl-C stops it, and so does panic.',
  ],
  history: [
    'history [<first> [<last>]] [-n] [-r] [-i]   history -c',
    'Lists history: the last 16, or a range. -n drops numbers, -r reverses, -i adds times.',
    '-c clears it, after you type yes. Expansion: !! !n !-n !prefix !?text? ^old^new, and :p to print only.',
  ],
  clear: ['clear', 'Clears the output. Ctrl-L does the same.'],
  help: ['help [<topic>]', 'Topics: every command, and keys, addresses, values, dali and scripts.'],
  echo: ['echo <text>', 'Prints the text.'],
  wait: ['wait <time>', 'Waits, as 300ms, 2s or 25min. Ctrl-C ends the wait.'],
  pause: ['pause ["message"]', 'In a script: shows the message and waits for Enter.'],
  use: [
    'use [<addr>]',
    'Sets a default address, after which it may be left out. use alone clears it.',
  ],
  raw: [
    'raw <hex> <hex> [x2]',
    'Sends one 16-bit frame as given, twice with x2. The governor judges it like any frame.',
  ],
  addresses: [
    'Addresses: 0 to 63 a short address, g0 to g15 a group, all for broadcast,',
    'unaddressed for gear without a short address, an alias from the Devices page,',
    'and 0,1 or 0..3 for a list or range, sent in order.',
  ],
  values: [
    'Values: 35% is output. A bare number is an arc level or channel level, 0 to 254.',
    '2700K is kelvin and 370m is mirek. Times are 300ms, 2s and 25min.',
  ],
  dali: [
    "Every DALI command the app supports, by python-dali's class name in kebab case:",
    'dapc 0 128, recall-max-level 0, dtr0 220, set-max-level 0, query-actual-level 0, go-to-scene 0 3.',
    'Device type commands get ENABLE DEVICE TYPE added, and send-twice commands go twice.',
    'Where a general and a device type command share a name, dt6- or dt8- names the device type one.',
  ],
  scripts: [
    'scripts lists the scripts. The Scripts page edits, imports and exports them.',
    'A script is one command a line, with wait <time>, pause "message", echo <text>,',
    'repeat <n> ... end (1 to 1000, nested twice at most) and # comments.',
    'Not in a script: unlock, lock, target, run, history, clear, use, resume, scripts, cap with a value.',
  ],
};

export const HELP_TOPICS: readonly string[] = [...Object.keys(TOPICS), 'keys'];

/** Help as lines of text. */
export function help(topic: string | undefined, platform: Platform): string[] {
  if (topic === undefined || topic === '') {
    return [
      'Commands: level off on tc rgb fade scene group query devices scan profile cap target trace',
      '  panic resume unlock lock run scripts history clear help echo wait use raw',
      'Every DALI command by name: help dali. Keys: help keys. Addresses and values: help addresses, help values.',
      'Escape twice is panic from anywhere.',
    ];
  }
  if (topic === 'keys') {
    const rows = legend(platform);
    const out = rows.map((r) => {
      const keys = r.keys.join(', ');
      const also =
        r.elsewhere.length > 0
          ? ` (also ${r.elsewhere.join(', ')} on a Mac or in an app window)`
          : '';
      return `${keys.padEnd(36)} ${r.does}${also}`;
    });
    if (platform === 'other')
      out.push(
        'Ctrl-W, Ctrl-N and Ctrl-T belong to the browser in a normal tab. An app window frees them.',
      );
    return out;
  }
  const t = TOPICS[topic];
  if (t !== undefined) return [...t];
  if (topic.includes('-')) return [`${topic} is a DALI command. See help dali.`];
  return [`No help for "${topic}". Type help for the list.`];
}
