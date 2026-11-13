/**
 * The command table: every control gear command Enlighten knows, as data.
 *
 * Opcodes, send-twice and reply kinds are checked byte for byte against python-dali by the golden
 * fixtures in `tests/golden/frames.json`. Which registers a command reads, sets or lets the gear
 * write is our own table from `docs/research/dali.md` section 6, not python-dali's `uses_dtr` flags.
 */

export type CommandKind = 'dapc' | 'standard' | 'special' | 'dt6' | 'dt8';
export type ReplyKind = 'none' | 'yesno' | 'value';
export type Register = 0 | 1 | 2;

/**
 * How a command carries a value.
 * - `level`: DAPC arc level 0 to 255.
 * - `nibble`: a scene or group number 0 to 15, added to the opcode.
 * - `byte`: the data byte of a special command, 0 to 255.
 * - `shortAddress`: a special command's data byte, (a << 1) | 1 for a = 0 to 63, or 0xFF for none.
 * - `initialise`: INITIALISE's data byte: 0 all gear, 0xFF gear without an address, or (a << 1) | 1.
 */
export type ParamKind = 'none' | 'level' | 'nibble' | 'byte' | 'shortAddress' | 'initialise';

export interface CommandSpec {
  readonly id: string;
  /** The python-dali class, as `module.ClassName`, used to find its golden fixtures. */
  readonly pd: string;
  /** Name as the standard writes it. */
  readonly label: string;
  readonly kind: CommandKind;
  /** Second byte for standard and device type commands, first byte for special commands. */
  readonly opcode: number;
  readonly param: ParamKind;
  readonly sendTwice: boolean;
  readonly reply: ReplyKind;
  readonly deviceType: 0 | 6 | 8;
  /** Registers whose value the gear reads. */
  readonly reads: readonly Register[];
  /** The register this command loads (DTR0, DTR1, DTR2). */
  readonly sets?: Register;
  /** Registers the gear may write as a side effect, so the master no longer knows them. */
  readonly gearWrites: readonly Register[];
}

type Opts = Partial<Pick<CommandSpec, 'param' | 'sendTwice' | 'reply' | 'reads' | 'gearWrites'>> & {
  sets?: Register;
};

function row(
  kind: CommandKind,
  id: string,
  label: string,
  opcode: number,
  pd: string,
  o: Opts = {},
): CommandSpec {
  const deviceType = kind === 'dt6' ? 6 : kind === 'dt8' ? 8 : 0;
  const spec: CommandSpec = {
    id,
    pd,
    label,
    kind,
    opcode,
    param: o.param ?? 'none',
    sendTwice: o.sendTwice ?? false,
    reply: o.reply ?? 'none',
    deviceType,
    reads: o.reads ?? [],
    gearWrites: o.gearWrites ?? [],
    ...(o.sets === undefined ? {} : { sets: o.sets }),
  };
  return spec;
}

const std = (id: string, label: string, op: number, pd: string, o?: Opts) =>
  row('standard', id, label, op, `general.${pd}`, o);
const q = (id: string, label: string, op: number, pd: string, o?: Opts) =>
  row('standard', id, label, op, `general.${pd}`, { reply: 'value', ...o });
const yn = (id: string, label: string, op: number, pd: string) =>
  row('standard', id, label, op, `general.${pd}`, { reply: 'yesno' });
const cfg = (id: string, label: string, op: number, pd: string, o?: Opts) =>
  row('standard', id, label, op, `general.${pd}`, { sendTwice: true, ...o });
const sp = (id: string, label: string, op: number, pd: string, o?: Opts) =>
  row('special', id, label, op, `general.${pd}`, o);
const d6 = (id: string, label: string, op: number, pd: string, o?: Opts) =>
  row('dt6', id, label, op, `led.${pd}`, o);
const d8 = (id: string, label: string, op: number, pd: string, o?: Opts) =>
  row('dt8', id, label, op, `colour.${pd}`, o);

const D0: Register[] = [0];
const D01: Register[] = [0, 1];
const D012: Register[] = [0, 1, 2];

export const COMMANDS: readonly CommandSpec[] = [
  row('dapc', 'DAPC', 'DAPC', 0, 'general.DAPC', { param: 'level' }),

  // Level commands (dali.md section 8)
  std('OFF', 'OFF', 0, 'Off'),
  std('UP', 'UP', 1, 'Up'),
  std('DOWN', 'DOWN', 2, 'Down'),
  std('STEP_UP', 'STEP UP', 3, 'StepUp'),
  std('STEP_DOWN', 'STEP DOWN', 4, 'StepDown'),
  std('RECALL_MAX_LEVEL', 'RECALL MAX LEVEL', 5, 'RecallMaxLevel'),
  std('RECALL_MIN_LEVEL', 'RECALL MIN LEVEL', 6, 'RecallMinLevel'),
  std('STEP_DOWN_AND_OFF', 'STEP DOWN AND OFF', 7, 'StepDownAndOff'),
  std('ON_AND_STEP_UP', 'ON AND STEP UP', 8, 'OnAndStepUp'),
  std('ENABLE_DAPC_SEQUENCE', 'ENABLE DAPC SEQUENCE', 9, 'EnableDAPCSequence'),
  std('GO_TO_LAST_ACTIVE_LEVEL', 'GO TO LAST ACTIVE LEVEL', 10, 'GoToLastActiveLevel'),
  std('CONTINUOUS_UP', 'CONTINUOUS UP', 11, 'ContinuousUp'),
  std('CONTINUOUS_DOWN', 'CONTINUOUS DOWN', 12, 'ContinuousDown'),
  std('GO_TO_SCENE', 'GO TO SCENE', 16, 'GoToScene', { param: 'nibble' }),

  // Configuration commands, all sent twice (dali.md section 6)
  cfg('RESET', 'RESET', 32, 'Reset'),
  cfg('STORE_ACTUAL_LEVEL_IN_DTR0', 'STORE ACTUAL LEVEL IN DTR0', 33, 'StoreActualLevelInDTR0', {
    gearWrites: D0,
  }),
  cfg('SAVE_PERSISTENT_VARIABLES', 'SAVE PERSISTENT VARIABLES', 34, 'SavePersistentVariables'),
  cfg('SET_OPERATING_MODE', 'SET OPERATING MODE', 35, 'SetOperatingMode', { reads: D0 }),
  cfg('RESET_MEMORY_BANK', 'RESET MEMORY BANK', 36, 'ResetMemoryBank', { reads: D0 }),
  cfg('IDENTIFY_DEVICE', 'IDENTIFY DEVICE', 37, 'IdentifyDevice'),
  cfg('SET_MAX_LEVEL', 'SET MAX LEVEL', 42, 'SetMaxLevel', { reads: D0 }),
  cfg('SET_MIN_LEVEL', 'SET MIN LEVEL', 43, 'SetMinLevel', { reads: D0 }),
  cfg('SET_SYSTEM_FAILURE_LEVEL', 'SET SYSTEM FAILURE LEVEL', 44, 'SetSystemFailureLevel', {
    reads: D0,
  }),
  cfg('SET_POWER_ON_LEVEL', 'SET POWER ON LEVEL', 45, 'SetPowerOnLevel', { reads: D0 }),
  cfg('SET_FADE_TIME', 'SET FADE TIME', 46, 'SetFadeTime', { reads: D0 }),
  cfg('SET_FADE_RATE', 'SET FADE RATE', 47, 'SetFadeRate', { reads: D0 }),
  cfg('SET_EXTENDED_FADE_TIME', 'SET EXTENDED FADE TIME', 48, 'SetExtendedFadeTime', { reads: D0 }),
  cfg('SET_SCENE', 'SET SCENE', 64, 'SetScene', { param: 'nibble', reads: D0 }),
  cfg('REMOVE_FROM_SCENE', 'REMOVE FROM SCENE', 80, 'RemoveFromScene', { param: 'nibble' }),
  cfg('ADD_TO_GROUP', 'ADD TO GROUP', 96, 'AddToGroup', { param: 'nibble' }),
  cfg('REMOVE_FROM_GROUP', 'REMOVE FROM GROUP', 112, 'RemoveFromGroup', { param: 'nibble' }),
  cfg('SET_SHORT_ADDRESS', 'SET SHORT ADDRESS', 128, 'SetShortAddress', { reads: D0 }),
  cfg('ENABLE_WRITE_MEMORY', 'ENABLE WRITE MEMORY', 129, 'EnableWriteMemory'),

  // Queries (dali.md section 10)
  q('QUERY_STATUS', 'QUERY STATUS', 144, 'QueryStatus'),
  yn('QUERY_CONTROL_GEAR_PRESENT', 'QUERY CONTROL GEAR PRESENT', 145, 'QueryControlGearPresent'),
  yn('QUERY_LAMP_FAILURE', 'QUERY LAMP FAILURE', 146, 'QueryLampFailure'),
  yn('QUERY_LAMP_POWER_ON', 'QUERY LAMP POWER ON', 147, 'QueryLampPowerOn'),
  yn('QUERY_LIMIT_ERROR', 'QUERY LIMIT ERROR', 148, 'QueryLimitError'),
  yn('QUERY_RESET_STATE', 'QUERY RESET STATE', 149, 'QueryResetState'),
  yn('QUERY_MISSING_SHORT_ADDRESS', 'QUERY MISSING SHORT ADDRESS', 150, 'QueryMissingShortAddress'),
  q('QUERY_VERSION_NUMBER', 'QUERY VERSION NUMBER', 151, 'QueryVersionNumber'),
  q('QUERY_CONTENT_DTR0', 'QUERY CONTENT DTR0', 152, 'QueryContentDTR0'),
  q('QUERY_DEVICE_TYPE', 'QUERY DEVICE TYPE', 153, 'QueryDeviceType'),
  q('QUERY_PHYSICAL_MINIMUM', 'QUERY PHYSICAL MINIMUM', 154, 'QueryPhysicalMinimum'),
  yn('QUERY_POWER_FAILURE', 'QUERY POWER FAILURE', 155, 'QueryPowerFailure'),
  q('QUERY_CONTENT_DTR1', 'QUERY CONTENT DTR1', 156, 'QueryContentDTR1'),
  q('QUERY_CONTENT_DTR2', 'QUERY CONTENT DTR2', 157, 'QueryContentDTR2'),
  q('QUERY_OPERATING_MODE', 'QUERY OPERATING MODE', 158, 'QueryOperatingMode'),
  q('QUERY_LIGHT_SOURCE_TYPE', 'QUERY LIGHT SOURCE TYPE', 159, 'QueryLightSourceType', {
    gearWrites: D012,
  }),
  q('QUERY_ACTUAL_LEVEL', 'QUERY ACTUAL LEVEL', 160, 'QueryActualLevel'),
  q('QUERY_MAX_LEVEL', 'QUERY MAX LEVEL', 161, 'QueryMaxLevel'),
  q('QUERY_MIN_LEVEL', 'QUERY MIN LEVEL', 162, 'QueryMinLevel'),
  q('QUERY_POWER_ON_LEVEL', 'QUERY POWER ON LEVEL', 163, 'QueryPowerOnLevel'),
  q('QUERY_SYSTEM_FAILURE_LEVEL', 'QUERY SYSTEM FAILURE LEVEL', 164, 'QuerySystemFailureLevel'),
  q('QUERY_FADE_TIME_FADE_RATE', 'QUERY FADE TIME/FADE RATE', 165, 'QueryFadeTimeFadeRate'),
  yn(
    'QUERY_MANUFACTURER_SPECIFIC_MODE',
    'QUERY MANUFACTURER SPECIFIC MODE',
    166,
    'QueryManufacturerSpecificMode',
  ),
  q('QUERY_NEXT_DEVICE_TYPE', 'QUERY NEXT DEVICE TYPE', 167, 'QueryNextDeviceType'),
  q('QUERY_EXTENDED_FADE_TIME', 'QUERY EXTENDED FADE TIME', 168, 'QueryExtendedFadeTime'),
  yn('QUERY_CONTROL_GEAR_FAILURE', 'QUERY CONTROL GEAR FAILURE', 170, 'QueryControlGearFailure'),
  q('QUERY_SCENE_LEVEL', 'QUERY SCENE LEVEL', 176, 'QuerySceneLevel', { param: 'nibble' }),
  q('QUERY_GROUPS_0_7', 'QUERY GROUPS 0-7', 192, 'QueryGroupsZeroToSeven'),
  q('QUERY_GROUPS_8_15', 'QUERY GROUPS 8-15', 193, 'QueryGroupsEightToFifteen'),
  q('QUERY_RANDOM_ADDRESS_H', 'QUERY RANDOM ADDRESS (H)', 194, 'QueryRandomAddressH'),
  q('QUERY_RANDOM_ADDRESS_M', 'QUERY RANDOM ADDRESS (M)', 195, 'QueryRandomAddressM'),
  q('QUERY_RANDOM_ADDRESS_L', 'QUERY RANDOM ADDRESS (L)', 196, 'QueryRandomAddressL'),
  q('READ_MEMORY_LOCATION', 'READ MEMORY LOCATION', 197, 'ReadMemoryLocation', {
    reads: D01,
    gearWrites: D0,
  }),

  // Special commands (dali.md sections 6 and 13). The opcode is the first byte.
  sp('TERMINATE', 'TERMINATE', 0xa1, 'Terminate'),
  sp('DTR0', 'DTR0', 0xa3, 'DTR0', { param: 'byte', sets: 0 }),
  sp('INITIALISE', 'INITIALISE', 0xa5, 'Initialise', { param: 'initialise', sendTwice: true }),
  sp('RANDOMISE', 'RANDOMISE', 0xa7, 'Randomise', { sendTwice: true }),
  sp('COMPARE', 'COMPARE', 0xa9, 'Compare', { reply: 'yesno' }),
  sp('WITHDRAW', 'WITHDRAW', 0xab, 'Withdraw'),
  sp('PING', 'PING', 0xad, 'Ping'),
  sp('SEARCHADDRH', 'SEARCHADDRH', 0xb1, 'SearchaddrH', { param: 'byte' }),
  sp('SEARCHADDRM', 'SEARCHADDRM', 0xb3, 'SearchaddrM', { param: 'byte' }),
  sp('SEARCHADDRL', 'SEARCHADDRL', 0xb5, 'SearchaddrL', { param: 'byte' }),
  sp('PROGRAM_SHORT_ADDRESS', 'PROGRAM SHORT ADDRESS', 0xb7, 'ProgramShortAddress', {
    param: 'shortAddress',
  }),
  sp('VERIFY_SHORT_ADDRESS', 'VERIFY SHORT ADDRESS', 0xb9, 'VerifyShortAddress', {
    param: 'shortAddress',
    reply: 'yesno',
  }),
  sp('QUERY_SHORT_ADDRESS', 'QUERY SHORT ADDRESS', 0xbb, 'QueryShortAddress', { reply: 'value' }),
  sp('ENABLE_DEVICE_TYPE', 'ENABLE DEVICE TYPE', 0xc1, 'EnableDeviceType', { param: 'byte' }),
  sp('DTR1', 'DTR1', 0xc3, 'DTR1', { param: 'byte', sets: 1 }),
  sp('DTR2', 'DTR2', 0xc5, 'DTR2', { param: 'byte', sets: 2 }),
  sp('WRITE_MEMORY_LOCATION', 'WRITE MEMORY LOCATION', 0xc7, 'WriteMemoryLocation', {
    param: 'byte',
    reply: 'value',
    reads: D01,
    gearWrites: D0,
  }),
  sp(
    'WRITE_MEMORY_LOCATION_NO_REPLY',
    'WRITE MEMORY LOCATION - NO REPLY',
    0xc9,
    'WriteMemoryLocationNoReply',
    { param: 'byte', reads: D01, gearWrites: D0 },
  ),

  // Part 207, LED gear (dali.md section 12)
  d6('DT6_REFERENCE_SYSTEM_POWER', 'REFERENCE SYSTEM POWER', 224, 'ReferenceSystemPower', {
    sendTwice: true,
  }),
  d6('DT6_ENABLE_CURRENT_PROTECTOR', 'ENABLE CURRENT PROTECTOR', 225, 'EnableCurrentProtector', {
    sendTwice: true,
  }),
  d6('DT6_DISABLE_CURRENT_PROTECTOR', 'DISABLE CURRENT PROTECTOR', 226, 'DisableCurrentProtector', {
    sendTwice: true,
  }),
  d6('DT6_SELECT_DIMMING_CURVE', 'SELECT DIMMING CURVE', 227, 'SelectDimmingCurve', {
    sendTwice: true,
    reads: D0,
  }),
  d6(
    'DT6_STORE_DTR_AS_FAST_FADE_TIME',
    'STORE DTR AS FAST FADE TIME',
    228,
    'StoreDTRAsFastFadeTime',
    {
      sendTwice: true,
      reads: D0,
    },
  ),
  d6('DT6_QUERY_GEAR_TYPE', 'QUERY GEAR TYPE', 237, 'QueryGearType', { reply: 'value' }),
  d6('DT6_QUERY_DIMMING_CURVE', 'QUERY DIMMING CURVE', 238, 'QueryDimmingCurve', {
    reply: 'value',
  }),
  d6(
    'DT6_QUERY_POSSIBLE_OPERATING_MODES',
    'QUERY POSSIBLE OPERATING MODES',
    239,
    'QueryPossibleOperatingModes',
    { reply: 'value' },
  ),
  d6('DT6_QUERY_FEATURES', 'QUERY FEATURES', 240, 'QueryFeatures', { reply: 'value' }),
  d6('DT6_QUERY_FAILURE_STATUS', 'QUERY FAILURE STATUS', 241, 'QueryFailureStatus', {
    reply: 'value',
  }),
  d6('DT6_QUERY_SHORT_CIRCUIT', 'QUERY SHORT CIRCUIT', 242, 'QueryShortCircuit', {
    reply: 'yesno',
  }),
  d6('DT6_QUERY_OPEN_CIRCUIT', 'QUERY OPEN CIRCUIT', 243, 'QueryOpenCircuit', { reply: 'yesno' }),
  d6('DT6_QUERY_LOAD_DECREASE', 'QUERY LOAD DECREASE', 244, 'QueryLoadDecrease', {
    reply: 'yesno',
  }),
  d6('DT6_QUERY_LOAD_INCREASE', 'QUERY LOAD INCREASE', 245, 'QueryLoadIncrease', {
    reply: 'yesno',
  }),
  d6(
    'DT6_QUERY_CURRENT_PROTECTOR_ACTIVE',
    'QUERY CURRENT PROTECTOR ACTIVE',
    246,
    'QueryCurrentProtectorActive',
    { reply: 'yesno' },
  ),
  d6('DT6_QUERY_THERMAL_SHUTDOWN', 'QUERY THERMAL SHUTDOWN', 247, 'QueryThermalShutDown', {
    reply: 'yesno',
  }),
  d6('DT6_QUERY_THERMAL_OVERLOAD', 'QUERY THERMAL OVERLOAD', 248, 'QueryThermalOverload', {
    reply: 'yesno',
  }),
  d6('DT6_QUERY_REFERENCE_RUNNING', 'QUERY REFERENCE RUNNING', 249, 'QueryReferenceRunning', {
    reply: 'yesno',
  }),
  d6(
    'DT6_QUERY_REFERENCE_MEASUREMENT_FAILED',
    'QUERY REFERENCE MEASUREMENT FAILED',
    250,
    'QueryReferenceMeasurementFailed',
    { reply: 'yesno' },
  ),
  d6(
    'DT6_QUERY_CURRENT_PROTECTOR_ENABLED',
    'QUERY CURRENT PROTECTOR ENABLED',
    251,
    'QueryCurrentProtectorEnabled',
    { reply: 'yesno' },
  ),
  d6('DT6_QUERY_OPERATING_MODE', 'QUERY OPERATING MODE', 252, 'QueryOperatingMode', {
    reply: 'value',
  }),
  d6('DT6_QUERY_FAST_FADE_TIME', 'QUERY FAST FADE TIME', 253, 'QueryFastFadeTime', {
    reply: 'value',
  }),
  d6('DT6_QUERY_MIN_FAST_FADE_TIME', 'QUERY MIN FAST FADE TIME', 254, 'QueryMinFastFadeTime', {
    reply: 'value',
  }),
  d6(
    'DT6_QUERY_EXTENDED_VERSION_NUMBER',
    'QUERY EXTENDED VERSION NUMBER',
    255,
    'QueryExtendedVersionNumber',
    { reply: 'value' },
  ),

  // Part 209, colour control (dali.md section 11)
  d8('DT8_SET_TEMPORARY_X', 'SET TEMPORARY x-COORDINATE', 224, 'SetTemporaryXCoordinate', {
    reads: D01,
  }),
  d8('DT8_SET_TEMPORARY_Y', 'SET TEMPORARY y-COORDINATE', 225, 'SetTemporaryYCoordinate', {
    reads: D01,
  }),
  d8('DT8_ACTIVATE', 'ACTIVATE', 226, 'Activate'),
  d8('DT8_X_STEP_UP', 'x-COORDINATE STEP UP', 227, 'XCoordinateStepUp'),
  d8('DT8_X_STEP_DOWN', 'x-COORDINATE STEP DOWN', 228, 'XCoordinateStepDown'),
  d8('DT8_Y_STEP_UP', 'y-COORDINATE STEP UP', 229, 'YCoordinateStepUp'),
  d8('DT8_Y_STEP_DOWN', 'y-COORDINATE STEP DOWN', 230, 'YCoordinateStepDown'),
  d8(
    'DT8_SET_TEMPORARY_TC',
    'SET TEMPORARY COLOUR TEMPERATURE Tc',
    231,
    'SetTemporaryColourTemperature',
    { reads: D01 },
  ),
  d8(
    'DT8_TC_STEP_COOLER',
    'COLOUR TEMPERATURE Tc STEP COOLER',
    232,
    'ColourTemperatureTcStepCooler',
  ),
  d8(
    'DT8_TC_STEP_WARMER',
    'COLOUR TEMPERATURE Tc STEP WARMER',
    233,
    'ColourTemperatureTcStepWarmer',
  ),
  d8(
    'DT8_SET_TEMPORARY_PRIMARY_N',
    'SET TEMPORARY PRIMARY N DIMLEVEL',
    234,
    'SetTemporaryPrimaryNDimLevel',
    { reads: D012 },
  ),
  d8('DT8_SET_TEMPORARY_RGB', 'SET TEMPORARY RGB DIMLEVEL', 235, 'SetTemporaryRGBDimLevel', {
    reads: D012,
  }),
  d8('DT8_SET_TEMPORARY_WAF', 'SET TEMPORARY WAF DIMLEVEL', 236, 'SetTemporaryWAFDimLevel', {
    reads: D012,
  }),
  d8(
    'DT8_SET_TEMPORARY_RGBWAF_CONTROL',
    'SET TEMPORARY RGBWAF CONTROL',
    237,
    'SetTemporaryRGBWAFControl',
    { reads: D0 },
  ),
  d8('DT8_COPY_REPORT_TO_TEMPORARY', 'COPY REPORT TO TEMPORARY', 238, 'CopyReportToTemporary'),
  d8('DT8_STORE_TY_PRIMARY_N', 'STORE TY PRIMARY N', 240, 'StoreTYPrimaryN', {
    sendTwice: true,
    reads: D012,
  }),
  d8('DT8_STORE_XY_PRIMARY_N', 'STORE XY-COORDINATE PRIMARY N', 241, 'StoreXYCoordinatePrimaryN', {
    sendTwice: true,
    reads: D012,
  }),
  d8(
    'DT8_STORE_TC_LIMIT',
    'STORE COLOUR TEMPERATURE Tc LIMIT',
    242,
    'StoreColourTemperatureTcLimit',
    { sendTwice: true, reads: D012 },
  ),
  d8('DT8_STORE_GEAR_FEATURES', 'STORE GEAR FEATURES/STATUS', 243, 'StoreGearFeaturesStatus', {
    sendTwice: true,
    reads: D0,
  }),
  d8(
    'DT8_ASSIGN_COLOUR_TO_LINKED_CHANNEL',
    'ASSIGN COLOUR TO LINKED CHANNEL',
    245,
    'AssignColourToLinkedChannel',
    { sendTwice: true, reads: D0 },
  ),
  d8('DT8_START_AUTO_CALIBRATION', 'START AUTO CALIBRATION', 246, 'StartAutoCalibration'),
  d8('DT8_QUERY_GEAR_FEATURES', 'QUERY GEAR FEATURES/STATUS', 247, 'QueryGearFeaturesStatus', {
    reply: 'value',
  }),
  d8('DT8_QUERY_COLOUR_STATUS', 'QUERY COLOUR STATUS', 248, 'QueryColourStatus', {
    reply: 'value',
  }),
  d8(
    'DT8_QUERY_COLOUR_TYPE_FEATURES',
    'QUERY COLOUR TYPE FEATURES',
    249,
    'QueryColourTypeFeatures',
    { reply: 'value' },
  ),
  d8('DT8_QUERY_COLOUR_VALUE', 'QUERY COLOUR VALUE', 250, 'QueryColourValue', {
    reply: 'value',
    reads: D0,
    gearWrites: D0,
  }),
  d8('DT8_QUERY_RGBWAF_CONTROL', 'QUERY RGBWAF CONTROL', 251, 'QueryRBGWAFControl', {
    reply: 'value',
  }),
  d8('DT8_QUERY_ASSIGNED_COLOUR', 'QUERY ASSIGNED COLOUR', 252, 'QueryAssignedColour', {
    reply: 'value',
    reads: D0,
  }),
  d8(
    'DT8_QUERY_EXTENDED_VERSION_NUMBER',
    'QUERY EXTENDED VERSION NUMBER',
    255,
    'QueryExtendedVersionNumber',
    { reply: 'value' },
  ),
];

const byId = new Map<string, CommandSpec>(COMMANDS.map((c) => [c.id, c]));

export function spec(id: string): CommandSpec {
  const s = byId.get(id);
  if (s === undefined) throw new RangeError(`unknown command ${id}`);
  return s;
}

export function hasSpec(id: string): boolean {
  return byId.has(id);
}

/** Lookup for decoding: standard opcodes (0 to 255, nibble commands expanded), special first bytes, and device type opcodes. */
export const STANDARD_BY_OPCODE = new Map<number, CommandSpec>();
export const SPECIAL_BY_OPCODE = new Map<number, CommandSpec>();
export const DT6_BY_OPCODE = new Map<number, CommandSpec>();
export const DT8_BY_OPCODE = new Map<number, CommandSpec>();

for (const c of COMMANDS) {
  if (c.kind === 'standard') {
    const n = c.param === 'nibble' ? 16 : 1;
    for (let i = 0; i < n; i++) STANDARD_BY_OPCODE.set(c.opcode + i, c);
  } else if (c.kind === 'special') SPECIAL_BY_OPCODE.set(c.opcode, c);
  else if (c.kind === 'dt6') DT6_BY_OPCODE.set(c.opcode, c);
  else if (c.kind === 'dt8') DT8_BY_OPCODE.set(c.opcode, c);
}
