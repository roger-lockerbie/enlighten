/**
 * The rule table in `docs/SPEC.md` section 5, as data. Default deny: a command not named here is refused.
 */

export type Rule =
  /** Allowed (queries, DTR loads, TERMINATE, ENABLE DEVICE TYPE). */
  | 'allow'
  | 'dapc'
  | 'off'
  /** Allowed only when every addressed gear is verified (indirect level commands down). */
  | 'verified-down'
  /** As `verified-down`, and the shadow's prediction is what the rate guard judges. */
  | 'verified-up'
  | 'enable-dapc-sequence'
  | 'set-max'
  | 'set-min'
  /** SET SCENE and SET SYSTEM FAILURE LEVEL: 255 allowed. */
  | 'set-scene'
  | 'set-power-on'
  | 'set-fade'
  /** REMOVE FROM SCENE, ADD TO GROUP, REMOVE FROM GROUP. */
  | 'membership'
  /** Gear-written registers: allowed, and the registers become unknown. */
  | 'gear-writes'
  | 'temp-tc'
  | 'temp-rgbwaf'
  | 'rgbwaf-control'
  | 'activate'
  | 'refuse-colour-type'
  | 'expert'
  | 'expert-curve'
  | 'reset'
  | 'commissioning'
  | 'refuse';

export const RULES: Readonly<Record<string, Rule>> = {
  DAPC: 'dapc',
  OFF: 'off',
  DOWN: 'verified-down',
  STEP_DOWN: 'verified-down',
  STEP_DOWN_AND_OFF: 'verified-down',
  RECALL_MIN_LEVEL: 'verified-down',
  CONTINUOUS_DOWN: 'verified-down',
  UP: 'verified-up',
  STEP_UP: 'verified-up',
  ON_AND_STEP_UP: 'verified-up',
  CONTINUOUS_UP: 'verified-up',
  RECALL_MAX_LEVEL: 'verified-up',
  GO_TO_LAST_ACTIVE_LEVEL: 'verified-up',
  GO_TO_SCENE: 'verified-up',
  ENABLE_DAPC_SEQUENCE: 'enable-dapc-sequence',
  DTR0: 'allow',
  DTR1: 'allow',
  DTR2: 'allow',
  SET_MAX_LEVEL: 'set-max',
  SET_MIN_LEVEL: 'set-min',
  SET_SCENE: 'set-scene',
  SET_SYSTEM_FAILURE_LEVEL: 'set-scene',
  SET_POWER_ON_LEVEL: 'set-power-on',
  SET_FADE_TIME: 'set-fade',
  SET_FADE_RATE: 'set-fade',
  SET_EXTENDED_FADE_TIME: 'set-fade',
  REMOVE_FROM_SCENE: 'membership',
  ADD_TO_GROUP: 'membership',
  REMOVE_FROM_GROUP: 'membership',
  STORE_ACTUAL_LEVEL_IN_DTR0: 'gear-writes',
  READ_MEMORY_LOCATION: 'gear-writes',
  DT8_SET_TEMPORARY_TC: 'temp-tc',
  DT8_SET_TEMPORARY_RGB: 'temp-rgbwaf',
  DT8_SET_TEMPORARY_WAF: 'temp-rgbwaf',
  DT8_SET_TEMPORARY_RGBWAF_CONTROL: 'rgbwaf-control',
  DT8_ACTIVATE: 'activate',
  DT8_TC_STEP_COOLER: 'verified-down',
  DT8_TC_STEP_WARMER: 'verified-down',
  DT8_COPY_REPORT_TO_TEMPORARY: 'verified-down',
  DT8_SET_TEMPORARY_X: 'refuse-colour-type',
  DT8_SET_TEMPORARY_Y: 'refuse-colour-type',
  DT8_X_STEP_UP: 'refuse-colour-type',
  DT8_X_STEP_DOWN: 'refuse-colour-type',
  DT8_Y_STEP_UP: 'refuse-colour-type',
  DT8_Y_STEP_DOWN: 'refuse-colour-type',
  DT8_SET_TEMPORARY_PRIMARY_N: 'refuse-colour-type',
  DT8_STORE_TC_LIMIT: 'expert',
  DT8_STORE_GEAR_FEATURES: 'expert',
  RESET: 'reset',
  INITIALISE: 'commissioning',
  RANDOMISE: 'commissioning',
  COMPARE: 'commissioning',
  WITHDRAW: 'commissioning',
  SEARCHADDRH: 'commissioning',
  SEARCHADDRM: 'commissioning',
  SEARCHADDRL: 'commissioning',
  PROGRAM_SHORT_ADDRESS: 'commissioning',
  VERIFY_SHORT_ADDRESS: 'commissioning',
  QUERY_SHORT_ADDRESS: 'commissioning',
  SET_SHORT_ADDRESS: 'commissioning',
  DT6_SELECT_DIMMING_CURVE: 'expert-curve',
  TERMINATE: 'allow',
  ENABLE_DEVICE_TYPE: 'allow',
  // Refused always (SPEC section 5).
  IDENTIFY_DEVICE: 'refuse',
  DT6_ENABLE_CURRENT_PROTECTOR: 'refuse',
  DT6_DISABLE_CURRENT_PROTECTOR: 'refuse',
  DT6_STORE_DTR_AS_FAST_FADE_TIME: 'refuse',
  SET_OPERATING_MODE: 'refuse',
  DT8_START_AUTO_CALIBRATION: 'refuse',
  DT6_REFERENCE_SYSTEM_POWER: 'refuse',
  ENABLE_WRITE_MEMORY: 'refuse',
  WRITE_MEMORY_LOCATION: 'refuse',
  WRITE_MEMORY_LOCATION_NO_REPLY: 'refuse',
  RESET_MEMORY_BANK: 'refuse',
  DT8_STORE_TY_PRIMARY_N: 'refuse',
  DT8_STORE_XY_PRIMARY_N: 'refuse',
  DT8_ASSIGN_COLOUR_TO_LINKED_CHANNEL: 'refuse',
};

/** The rule for a command. Queries are allowed. Anything else not in the table is refused. */
export function ruleFor(id: string, isQuery: boolean): Rule {
  const r = RULES[id];
  if (r !== undefined) return r;
  return isQuery ? 'allow' : 'refuse';
}

/** Commands an unverified address accepts from any source (SPEC section 5, last paragraph). */
export const UNVERIFIED_OK: ReadonlySet<Rule> = new Set<Rule>([
  'allow',
  'dapc',
  'off',
  'gear-writes',
]);

/** The safety profile's own writes, accepted on an unverified address from the profile only. */
export const PROFILE_WRITES: ReadonlySet<string> = new Set([
  'SET_MAX_LEVEL',
  'SET_MIN_LEVEL',
  'SET_POWER_ON_LEVEL',
  'SET_SYSTEM_FAILURE_LEVEL',
  'DT8_SET_TEMPORARY_TC',
  'DT8_SET_TEMPORARY_RGB',
  'DT8_SET_TEMPORARY_WAF',
]);

/** Commands that can change light output, so the rate guard and the unknown-state rules apply. */
export const LIGHT_CHANGING: ReadonlySet<string> = new Set([
  'DAPC',
  'OFF',
  'UP',
  'DOWN',
  'STEP_UP',
  'STEP_DOWN',
  'RECALL_MAX_LEVEL',
  'RECALL_MIN_LEVEL',
  'STEP_DOWN_AND_OFF',
  'ON_AND_STEP_UP',
  'GO_TO_LAST_ACTIVE_LEVEL',
  'CONTINUOUS_UP',
  'CONTINUOUS_DOWN',
  'GO_TO_SCENE',
  'RESET',
  'SET_MAX_LEVEL',
  'SET_MIN_LEVEL',
  'IDENTIFY_DEVICE',
  'DT8_ACTIVATE',
  'DT8_TC_STEP_COOLER',
  'DT8_TC_STEP_WARMER',
  'DT6_SELECT_DIMMING_CURVE',
]);

/** Group changes and addressing: the inventory goes stale (SPEC section 5). */
export const STALES_INVENTORY: ReadonlySet<string> = new Set([
  'ADD_TO_GROUP',
  'REMOVE_FROM_GROUP',
  'INITIALISE',
  'RANDOMISE',
  'PROGRAM_SHORT_ADDRESS',
  'SET_SHORT_ADDRESS',
]);
