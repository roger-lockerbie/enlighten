/**
 * What each DALI command does, for `help <command>` (SPEC section 6, ADR 0023).
 *
 * The text is our own, written from the public sources gathered in `docs/research/dali.md`. The IEC
 * 62386 text is paywalled, was not read and is not quoted. An entry marked `general` describes a
 * command the research notes name without saying what it does: it rests on general knowledge of the
 * standard, and help says so. Everything else help shows about a command (its frame, reply, DTRs,
 * send-twice and the governor's rule) is built from the command table and the rule table, not from
 * this file, so it cannot drift from what the app does.
 */

export type DaliGroup =
  'level' | 'config' | 'query' | 'register' | 'address' | 'memory' | 'dt6' | 'dt8';

export const GROUP_TITLES: Readonly<Record<DaliGroup, string>> = {
  level: 'Levels',
  config: 'Settings kept in the gear',
  query: 'Queries',
  register: 'Registers and bus control',
  address: 'Addressing',
  memory: 'Memory banks',
  dt6: 'LED gear (device type 6, part 207)',
  dt8: 'Colour (device type 8, part 209)',
};

export interface DaliHelp {
  readonly group: DaliGroup;
  /** What the command does, in a sentence or three. */
  readonly does: string;
  /** The console's own command for the same job, or where to look next. */
  readonly see?: string;
  /** True when the research notes do not describe the command's behaviour. */
  readonly general?: true;
}

const e = (group: DaliGroup, does: string, see?: string): DaliHelp =>
  see === undefined ? { group, does } : { group, does, see };
const g = (group: DaliGroup, does: string, see?: string): DaliHelp => ({
  ...e(group, does, see),
  general: true,
});

const YES_NO = 'The gear answers yes, or stays silent for no.';
const Q = 'query <addr> shows the usual values together.';

export const DALI_HELP: Readonly<Record<string, DaliHelp>> = {
  // Levels
  DAPC: e(
    'level',
    'Direct arc power control: the gear fades to the level over its fade time, held within MIN LEVEL and MAX LEVEL. 0 switches off and 255 (mask) stops a running fade and holds. It switches the light on from off.',
    'level <addr> <value> does the same and takes a percentage.',
  ),
  OFF: e('level', 'Switches the light off at once, with no fade.', 'off <addr>'),
  UP: e(
    'level',
    'Dims up for 200 ms at the fade rate. It stops at MAX LEVEL and does not switch the light on. Sending it again within the 200 ms keeps it going.',
  ),
  DOWN: e(
    'level',
    'Dims down for 200 ms at the fade rate. It stops at MIN LEVEL and does not switch the light off.',
  ),
  STEP_UP: e(
    'level',
    'One arc level up at once, with no fade. It does not go above MAX LEVEL and does not switch the light on.',
  ),
  STEP_DOWN: e(
    'level',
    'One arc level down at once, with no fade. It does not go below MIN LEVEL and does not switch the light off.',
  ),
  RECALL_MAX_LEVEL: e(
    'level',
    'Goes to MAX LEVEL at once, with no fade. It switches the light on.',
  ),
  RECALL_MIN_LEVEL: e(
    'level',
    'Goes to MIN LEVEL at once, with no fade. It switches the light on.',
  ),
  STEP_DOWN_AND_OFF: e(
    'level',
    'One arc level down at once. At MIN LEVEL it switches the light off.',
  ),
  ON_AND_STEP_UP: e(
    'level',
    'One arc level up at once. From off it switches the light on at MIN LEVEL.',
  ),
  ENABLE_DAPC_SEQUENCE: e(
    'level',
    'Starts a DAPC sequence: while DAPCs keep arriving within 200 ms of each other, the gear fades each one over 200 ms whatever its fade time is. Any other level command ends it. It is how a slider dims smoothly.',
  ),
  GO_TO_LAST_ACTIVE_LEVEL: e(
    'level',
    'From off, fades to the last level the light had while it was on, over the fade time. Straight after power-up it goes to MAX LEVEL. A DALI-2 command.',
    'on <addr>',
  ),
  CONTINUOUS_UP: e(
    'level',
    'Fades up at the fade rate until MAX LEVEL, without stopping after 200 ms. A DALI-2 command. Its detail rests on python-dali, not on a vendor document.',
  ),
  CONTINUOUS_DOWN: e(
    'level',
    'Fades down at the fade rate until MIN LEVEL, without stopping after 200 ms. A DALI-2 command. Its detail rests on python-dali, not on a vendor document.',
  ),
  GO_TO_SCENE: e(
    'level',
    'Fades to the level stored for the scene, over the fade time, and switches the light on from off. A scene stored as 255 is not set, and nothing happens. On colour gear the scene can hold a colour too.',
    'scene <addr> recall <n>',
  ),

  // Settings kept in the gear
  RESET: e(
    'config',
    'Puts the gear back to the reset values of the standard: level 254, MAX LEVEL 254, power-on and system failure level 254, no groups, no scenes, fade time 0 and fade rate 7. The short address stays. The light goes to full output, and the gear may take 300 ms before it hears another command.',
  ),
  STORE_ACTUAL_LEVEL_IN_DTR0: e(
    'config',
    'The gear copies its present level into DTR0. After it the app cannot know DTR0 without asking.',
    'query-content-dtr0 <addr> reads the value.',
  ),
  SAVE_PERSISTENT_VARIABLES: g(
    'config',
    'Asks the gear to write its stored settings to permanent memory now. A DALI-2 command.',
  ),
  SET_OPERATING_MODE: g(
    'config',
    'Sets the operating mode from DTR0. 0 is the standard mode, and 0x80 to 0xFF are manufacturer modes.',
  ),
  IDENTIFY_DEVICE: e(
    'config',
    'Starts a 10 second identification that the manufacturer defines. What the DA5-L does is not known, and it may flash to full.',
  ),
  SET_MAX_LEVEL: e(
    'config',
    'Stores DTR0 as MAX LEVEL. A value below MIN LEVEL stores MIN LEVEL, and 255 stores 254. It is the gear side of the brightness ceiling.',
    'cap <value> sets the ceiling and writes MAX LEVEL on every driver.',
  ),
  SET_MIN_LEVEL: e(
    'config',
    'Stores DTR0 as MIN LEVEL. A value above MAX LEVEL, or 255, stores MAX LEVEL. A value below the physical minimum stores the physical minimum.',
  ),
  SET_SYSTEM_FAILURE_LEVEL: e(
    'config',
    'Stores DTR0 as the level the gear goes to when the bus has been without voltage for more than 500 ms. 255 means stay as it is. The level is limited by MIN and MAX when it is used.',
  ),
  SET_POWER_ON_LEVEL: e(
    'config',
    'Stores DTR0 as the level the gear goes to at power-up if no command arrives in the first 0.6 s. In DALI-2, 0 means stay off and 255 means the last level before power was lost.',
  ),
  SET_FADE_TIME: e(
    'config',
    'Stores DTR0 as the fade time, 0 to 15. The time is 0.5 s times the square root of 2 to the power n: 1 is 0.7 s, 4 is 2 s, 8 is 8 s, 15 is 90.5 s. 0 means no fade, unless a fast or extended fade time is set. It takes effect at the next level command.',
    'fade <addr> <time> picks the nearest value and says which.',
  ),
  SET_FADE_RATE: e(
    'config',
    'Stores DTR0 as the fade rate, 1 to 15, which UP, DOWN and the continuous commands use. 1 is 358 steps a second, 7 is 44.7 and 15 is 2.8. 0 is not allowed.',
    'fade <addr> rate <n>',
  ),
  SET_EXTENDED_FADE_TIME: e(
    'config',
    'Stores DTR0 as the extended fade time, used while the fade time is 0. Bits 3 to 0 are the base and bits 6 to 4 the multiplier (100 ms, 1 s, 10 s, 1 minute). The time is (base + 1) times the multiplier, up to 16 minutes at 0x4F. A DALI-2 command.',
    'fade <addr> <time> picks the nearest value and says which.',
  ),
  SET_SCENE: e(
    'config',
    'Stores DTR0 as the level of the scene. 255 takes the gear out of the scene. The level is limited by MIN and MAX when the scene is recalled, not when it is stored.',
    'scene <addr> store <n> [<value>] stores and reads it back.',
  ),
  REMOVE_FROM_SCENE: e(
    'config',
    'Takes the gear out of the scene, by storing 255 for it.',
    'scene <addr> remove <n>',
  ),
  ADD_TO_GROUP: e('config', 'Makes the gear a member of the group.', 'group <addr> add <n>'),
  REMOVE_FROM_GROUP: e('config', 'Takes the gear out of the group.', 'group <addr> remove <n>'),
  SET_SHORT_ADDRESS: e(
    'config',
    'Stores DTR0 as the short address: (address times 2) plus 1, or 255 to remove it. Sent to broadcast with DTR0 255 it clears every short address on the bus.',
    'The Devices page commissions gear step by step.',
  ),

  // Queries
  QUERY_STATUS: e(
    'query',
    'Answers the status byte. Bits 0 to 7: gear failure, lamp failure, lamp on, limit error, fade running, reset state, missing short address, power failure.',
    Q,
  ),
  QUERY_CONTROL_GEAR_PRESENT: e('query', `Asks whether gear is there. ${YES_NO}`),
  QUERY_LAMP_FAILURE: e('query', `Asks whether the lamp has failed. ${YES_NO}`),
  QUERY_LAMP_POWER_ON: e('query', `Asks whether the lamp is on. ${YES_NO}`),
  QUERY_LIMIT_ERROR: e(
    'query',
    `Asks whether the last level asked for was outside MIN LEVEL to MAX LEVEL and was limited. ${YES_NO}`,
  ),
  QUERY_RESET_STATE: e(
    'query',
    `Asks whether the gear's settings are all at their reset values. ${YES_NO}`,
  ),
  QUERY_MISSING_SHORT_ADDRESS: e('query', `Asks whether the gear has no short address. ${YES_NO}`),
  QUERY_VERSION_NUMBER: e(
    'query',
    'Answers the version of the standard the gear follows, from memory bank 0, location 0x16.',
  ),
  QUERY_CONTENT_DTR0: e('query', 'Answers the value in DTR0.'),
  QUERY_DEVICE_TYPE: e(
    'query',
    'Answers the device type: 6 for LED gear, 8 for colour control. 254 means none, and 255 means more than one, which QUERY NEXT DEVICE TYPE then lists.',
    'query <addr> type',
  ),
  QUERY_PHYSICAL_MINIMUM: e(
    'query',
    'Answers the lowest arc level the hardware can make. MIN LEVEL cannot be set below it.',
    'query <addr> phm',
  ),
  QUERY_POWER_FAILURE: e(
    'query',
    `Asks whether the gear has had no level command or RESET since it was powered up. ${YES_NO}`,
  ),
  QUERY_CONTENT_DTR1: e('query', 'Answers the value in DTR1.'),
  QUERY_CONTENT_DTR2: e('query', 'Answers the value in DTR2.'),
  QUERY_OPERATING_MODE: e('query', 'Answers the operating mode. 0 is the standard mode.'),
  QUERY_LIGHT_SOURCE_TYPE: e(
    'query',
    'Answers the kind of light source: 6 is LED. The gear can write all three DTRs while answering.',
  ),
  QUERY_ACTUAL_LEVEL: e(
    'query',
    'Answers the present arc level. 255 means the gear is starting up or has a lamp error.',
    'query <addr> level',
  ),
  QUERY_MAX_LEVEL: e('query', 'Answers MAX LEVEL.', 'query <addr> max'),
  QUERY_MIN_LEVEL: e('query', 'Answers MIN LEVEL.', 'query <addr> min'),
  QUERY_POWER_ON_LEVEL: e('query', 'Answers the power-on level.', 'query <addr> power-on'),
  QUERY_SYSTEM_FAILURE_LEVEL: e(
    'query',
    'Answers the system failure level. 255 means the gear stays as it is when the bus fails.',
    'query <addr> failure',
  ),
  QUERY_FADE_TIME_FADE_RATE: e(
    'query',
    'Answers one byte: the high four bits are the fade time and the low four the fade rate.',
    'fade <addr> shows the fade in use.',
  ),
  QUERY_MANUFACTURER_SPECIFIC_MODE: e(
    'query',
    `Asks whether the operating mode is a manufacturer mode, 0x80 to 0xFF. ${YES_NO}`,
  ),
  QUERY_NEXT_DEVICE_TYPE: e(
    'query',
    'Answers the next device type of gear that has several, and 254 at the end. It is valid only straight after QUERY DEVICE TYPE or itself.',
  ),
  QUERY_EXTENDED_FADE_TIME: e(
    'query',
    'Answers the extended fade time byte: bits 6 to 4 the multiplier, bits 3 to 0 the base.',
    'fade <addr> shows the fade in use.',
  ),
  QUERY_CONTROL_GEAR_FAILURE: e('query', `Asks whether the gear itself has failed. ${YES_NO}`),
  QUERY_SCENE_LEVEL: e(
    'query',
    'Answers the level stored for the scene, or 255 when the gear is not in it.',
    'scene <addr> list',
  ),
  QUERY_GROUPS_0_7: e(
    'query',
    'Answers one byte with a bit for each of groups 0 to 7 the gear is in.',
    'query <addr> groups',
  ),
  QUERY_GROUPS_8_15: e(
    'query',
    'Answers one byte with a bit for each of groups 8 to 15 the gear is in.',
    'query <addr> groups',
  ),
  QUERY_RANDOM_ADDRESS_H: e('query', 'Answers the high byte of the 24-bit random address.'),
  QUERY_RANDOM_ADDRESS_M: e('query', 'Answers the middle byte of the 24-bit random address.'),
  QUERY_RANDOM_ADDRESS_L: e('query', 'Answers the low byte of the 24-bit random address.'),

  // Registers and bus control
  TERMINATE: e(
    'register',
    'Ends the addressing window that INITIALISE opened, on every gear. It is also the one command, with QUERY COLOUR STATUS, that gear in automatic calibration still hears.',
    'panic sends TERMINATE and then OFF to every light.',
  ),
  DTR0: e(
    'register',
    'Loads a byte into data transfer register 0 on every gear on the bus. The commands that store a setting then read it.',
  ),
  DTR1: e(
    'register',
    'Loads a byte into data transfer register 1 on every gear on the bus. Colour commands use it for the high byte of a 16-bit value.',
  ),
  DTR2: e(
    'register',
    'Loads a byte into data transfer register 2 on every gear on the bus. The colour commands that take three values use it.',
  ),
  ENABLE_DEVICE_TYPE: e(
    'register',
    'Says that the next command is for one device type, such as 6 or 8. The console adds it for you when you type a device type command by name.',
  ),
  PING: g(
    'register',
    'A frame that gear ignores. A bus master sends it to show others that it is there.',
  ),

  // Addressing
  INITIALISE: e(
    'address',
    'Opens a 15 minute window in which the addressing commands work. It goes to all gear, to gear without a short address, or to one address.',
    'The Devices page commissions gear step by step.',
  ),
  RANDOMISE: e(
    'address',
    'Each gear in the addressing window picks a new 24-bit random address. Allow 100 ms before the next command.',
  ),
  COMPARE: e(
    'address',
    'Gear answers yes when its random address is at or below the search address and it has not been withdrawn. A garbled answer means more than one answered.',
  ),
  WITHDRAW: e(
    'address',
    'The gear whose random address equals the search address stops answering COMPARE, so the search can find the next one.',
  ),
  SEARCHADDRH: e('address', 'Sets the high byte of the 24-bit search address.'),
  SEARCHADDRM: e('address', 'Sets the middle byte of the 24-bit search address.'),
  SEARCHADDRL: e('address', 'Sets the low byte of the 24-bit search address.'),
  PROGRAM_SHORT_ADDRESS: e(
    'address',
    'Gives the short address to the gear whose random address equals the search address. none removes it.',
  ),
  VERIFY_SHORT_ADDRESS: e(
    'address',
    `Asks whether any gear in the addressing window has this short address. ${YES_NO}`,
  ),
  QUERY_SHORT_ADDRESS: g(
    'address',
    'The gear whose random address equals the search address answers its short address, or 255 for none.',
  ),

  // Memory banks
  RESET_MEMORY_BANK: g(
    'memory',
    'Puts memory banks back to their reset contents. DTR0 chooses which: 0 for every bank that can be reset.',
  ),
  ENABLE_WRITE_MEMORY: g(
    'memory',
    'Lets the memory bank writes that follow take effect. Any other command ends it.',
  ),
  READ_MEMORY_LOCATION: e(
    'memory',
    'Answers one byte of a memory bank: the bank is in DTR1 and the location in DTR0. The gear then adds 1 to DTR0, so a run of reads walks the bank.',
  ),
  WRITE_MEMORY_LOCATION: g(
    'memory',
    'Writes a byte to the memory bank in DTR1 at the location in DTR0, and answers the byte written. The gear then adds 1 to DTR0.',
  ),
  WRITE_MEMORY_LOCATION_NO_REPLY: g(
    'memory',
    'Writes a byte to the memory bank in DTR1 at the location in DTR0, with no answer. The gear then adds 1 to DTR0.',
  ),

  // LED gear
  DT6_REFERENCE_SYSTEM_POWER: e(
    'dt6',
    'Starts a measurement of the load, which the gear later compares against to report a load change. While it runs, for up to 15 minutes, the gear ignores everything but queries and TERMINATE, so panic could not switch it off.',
  ),
  DT6_ENABLE_CURRENT_PROTECTOR: g('dt6', "Switches the gear's current protector on."),
  DT6_DISABLE_CURRENT_PROTECTOR: g('dt6', "Switches the gear's current protector off."),
  DT6_SELECT_DIMMING_CURVE: e(
    'dt6',
    'Chooses the dimming curve from DTR0: 0 is the standard logarithmic curve and 1 is linear. Under the linear curve arc level 127 is about half output, where the standard curve gives 3%, so a ceiling held as an arc level means far more light.',
  ),
  DT6_STORE_DTR_AS_FAST_FADE_TIME: e(
    'dt6',
    'Stores DTR0 as the fast fade time, in counts of 25 ms up to 27 and not below the minimum of the gear. While the fade time is 0, a fast fade time above 0 is the fade that applies.',
  ),
  DT6_QUERY_GEAR_TYPE: g('dt6', 'Answers a byte of bits that describe how the LED gear is built.'),
  DT6_QUERY_DIMMING_CURVE: e(
    'dt6',
    'Answers the dimming curve: 0 standard (logarithmic), 1 linear. The safety profile checks it on connect.',
  ),
  DT6_QUERY_POSSIBLE_OPERATING_MODES: g(
    'dt6',
    'Answers a byte of bits for the ways the gear can drive its LEDs.',
  ),
  DT6_QUERY_FEATURES: g(
    'dt6',
    'Answers a byte of bits for the optional features the gear has, such as which faults it can detect.',
  ),
  DT6_QUERY_FAILURE_STATUS: g(
    'dt6',
    'Answers a byte of bits for the faults present now, such as short circuit, open circuit and thermal events.',
  ),
  DT6_QUERY_SHORT_CIRCUIT: e('dt6', `Asks whether a short circuit is detected. ${YES_NO}`),
  DT6_QUERY_OPEN_CIRCUIT: e('dt6', `Asks whether an open circuit is detected. ${YES_NO}`),
  DT6_QUERY_LOAD_DECREASE: e(
    'dt6',
    `Asks whether the load is lower than at the reference measurement. ${YES_NO}`,
  ),
  DT6_QUERY_LOAD_INCREASE: e(
    'dt6',
    `Asks whether the load is higher than at the reference measurement. ${YES_NO}`,
  ),
  DT6_QUERY_CURRENT_PROTECTOR_ACTIVE: g(
    'dt6',
    `Asks whether the current protector is acting now. ${YES_NO}`,
  ),
  DT6_QUERY_THERMAL_SHUTDOWN: e(
    'dt6',
    `Asks whether the gear has shut down because of heat. ${YES_NO}`,
  ),
  DT6_QUERY_THERMAL_OVERLOAD: e(
    'dt6',
    `Asks whether the gear has reduced its output because of heat. ${YES_NO}`,
  ),
  DT6_QUERY_REFERENCE_RUNNING: g(
    'dt6',
    `Asks whether the reference measurement is running. ${YES_NO}`,
  ),
  DT6_QUERY_REFERENCE_MEASUREMENT_FAILED: g(
    'dt6',
    `Asks whether the last reference measurement failed. ${YES_NO}`,
  ),
  DT6_QUERY_CURRENT_PROTECTOR_ENABLED: g(
    'dt6',
    `Asks whether the current protector is switched on. ${YES_NO}`,
  ),
  DT6_QUERY_OPERATING_MODE: g(
    'dt6',
    'Answers a byte of bits for the way the gear drives its LEDs now.',
  ),
  DT6_QUERY_FAST_FADE_TIME: e(
    'dt6',
    'Answers the fast fade time, in counts of 25 ms. 0 means none is set.',
  ),
  DT6_QUERY_MIN_FAST_FADE_TIME: e(
    'dt6',
    'Answers the shortest fast fade time the gear can do, in counts of 25 ms.',
  ),
  DT6_QUERY_EXTENDED_VERSION_NUMBER: e('dt6', 'Answers the version of part 207 the gear follows.'),

  // Colour
  DT8_SET_TEMPORARY_X: e(
    'dt8',
    'Loads a temporary x coordinate from DTR0 (low byte) and DTR1 (high byte), in units of 1/65536. Nothing changes until ACTIVATE.',
  ),
  DT8_SET_TEMPORARY_Y: e(
    'dt8',
    'Loads a temporary y coordinate from DTR0 (low byte) and DTR1 (high byte), in units of 1/65536. Nothing changes until ACTIVATE.',
  ),
  DT8_ACTIVATE: e(
    'dt8',
    'Brings the temporary colour into use. It ends a colour fade that is running and starts a new one. Gear with automatic activation also brings the colour in at the next level command.',
    'tc and rgb send it for you.',
  ),
  DT8_X_STEP_UP: g('dt8', 'Moves the x coordinate up by one step, with no fade.'),
  DT8_X_STEP_DOWN: g('dt8', 'Moves the x coordinate down by one step, with no fade.'),
  DT8_Y_STEP_UP: g('dt8', 'Moves the y coordinate up by one step, with no fade.'),
  DT8_Y_STEP_DOWN: g('dt8', 'Moves the y coordinate down by one step, with no fade.'),
  DT8_SET_TEMPORARY_TC: e(
    'dt8',
    'Loads a temporary colour temperature in mirek (1,000,000 divided by kelvin) from DTR0 (low byte) and DTR1 (high byte). 2700 K is 370. 0 is ignored. Nothing changes until ACTIVATE.',
    'tc <addr> <temperature> [<value>]',
  ),
  DT8_TC_STEP_COOLER: e(
    'dt8',
    'Moves the colour temperature 1 mirek cooler, with no fade. It stops at the coolest limit and works only while colour temperature is the colour type in use.',
  ),
  DT8_TC_STEP_WARMER: e(
    'dt8',
    'Moves the colour temperature 1 mirek warmer, with no fade. It stops at the warmest limit and works only while colour temperature is the colour type in use.',
  ),
  DT8_SET_TEMPORARY_PRIMARY_N: e(
    'dt8',
    'Loads a temporary dim level for one primary: the value in DTR0 and DTR1, and the primary in DTR2. Nothing changes until ACTIVATE.',
  ),
  DT8_SET_TEMPORARY_RGB: e(
    'dt8',
    'Loads temporary channel levels: red from DTR0, green from DTR1, blue from DTR2, each 0 to 254, or 255 for no change. Nothing changes until ACTIVATE.',
    'rgb <addr> <r> <g> <b> [w <n>] [a <n>]',
  ),
  DT8_SET_TEMPORARY_WAF: e(
    'dt8',
    'Loads temporary channel levels: white from DTR0, amber from DTR1, free colour from DTR2, each 0 to 254, or 255 for no change. Nothing changes until ACTIVATE.',
    'rgb <addr> <r> <g> <b> [w <n>] [a <n>]',
  ),
  DT8_SET_TEMPORARY_RGBWAF_CONTROL: e(
    'dt8',
    'Loads the temporary RGBWAF control byte from DTR0: bits 0 to 5 link channels, and bits 7 and 6 choose channel control (0), colour control (1) or normalised colour control (2).',
  ),
  DT8_COPY_REPORT_TO_TEMPORARY: e(
    'dt8',
    'Copies the colour the gear reports into the temporary colour.',
  ),
  DT8_STORE_TY_PRIMARY_N: e('dt8', 'Stores calibration data for one primary.'),
  DT8_STORE_XY_PRIMARY_N: e('dt8', 'Stores the xy coordinate of one primary, as calibration data.'),
  DT8_STORE_TC_LIMIT: e(
    'dt8',
    'Stores a colour temperature limit: the value in DTR0 and DTR1, and in DTR2 which limit (0 coolest, 1 warmest, 2 physical coolest, 3 physical warmest).',
  ),
  DT8_STORE_GEAR_FEATURES: e(
    'dt8',
    'Stores the gear features byte from DTR0. Bit 0 is automatic activation: with it set, a level command also brings in a temporary colour.',
  ),
  DT8_ASSIGN_COLOUR_TO_LINKED_CHANNEL: e(
    'dt8',
    'Changes which colour the linked output channels are, from DTR0. Afterwards every temporary colour setting is cleared.',
  ),
  DT8_START_AUTO_CALIBRATION: e(
    'dt8',
    'Starts a calibration the gear runs on its own for up to 15 minutes. While it runs the gear hears only TERMINATE, QUERY COLOUR STATUS and this command.',
  ),
  DT8_QUERY_GEAR_FEATURES: e(
    'dt8',
    'Answers the gear features byte. Bit 0 is automatic activation.',
  ),
  DT8_QUERY_COLOUR_STATUS: e(
    'dt8',
    'Answers the colour status: bit 0 xy out of range, bit 1 colour temperature out of range, bits 2 and 3 calibration, bits 4 to 7 the colour type in use.',
  ),
  DT8_QUERY_COLOUR_TYPE_FEATURES: e(
    'dt8',
    'Answers what colour control the gear has: bit 0 xy, bit 1 colour temperature, bits 2 to 4 the number of primaries, bits 5 to 7 the number of RGBWAF channels.',
  ),
  DT8_QUERY_COLOUR_VALUE: e(
    'dt8',
    'Answers the high byte of a 16-bit colour value and leaves the low byte in DTR0. DTR0 chooses the value first: 2 is the colour temperature, 9 to 14 the six channel levels, 128 to 131 the temperature limits. Send QUERY ACTUAL LEVEL before it so the values are fresh.',
    'query <addr> tc reads the colour temperature in one step.',
  ),
  DT8_QUERY_RGBWAF_CONTROL: g('dt8', 'Answers the RGBWAF control byte in use.'),
  DT8_QUERY_ASSIGNED_COLOUR: e(
    'dt8',
    'Answers the colour of the channel named in DTR0 (0 to 5): 0 none, 1 red, 2 green, 3 blue, 4 white, 5 amber, 6 free colour, 255 for a channel that does not exist.',
  ),
  DT8_QUERY_EXTENDED_VERSION_NUMBER: e('dt8', 'Answers the version of part 209 the gear follows.'),
};
