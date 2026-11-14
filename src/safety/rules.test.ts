/**
 * U-safety: the rule table against `docs/SPEC.md` section 5, row by row, and the sets the governor
 * keys its other checks on.
 */
import { describe, expect, it } from 'vitest';
import { hasSpec } from '../dali/commands.ts';
import {
  LIGHT_CHANGING,
  PROFILE_WRITES,
  ruleFor,
  RULES,
  STALES_INVENTORY,
  UNVERIFIED_OK,
  type Rule,
} from './rules.ts';

/** SPEC section 5, one entry per row. */
const SPEC_ROWS: readonly (readonly [Rule, readonly string[]])[] = [
  ['dapc', ['DAPC']],
  ['off', ['OFF']],
  [
    'verified-down',
    ['DOWN', 'STEP_DOWN', 'STEP_DOWN_AND_OFF', 'RECALL_MIN_LEVEL', 'CONTINUOUS_DOWN'],
  ],
  [
    'verified-up',
    [
      'UP',
      'STEP_UP',
      'ON_AND_STEP_UP',
      'CONTINUOUS_UP',
      'RECALL_MAX_LEVEL',
      'GO_TO_LAST_ACTIVE_LEVEL',
      'GO_TO_SCENE',
    ],
  ],
  ['enable-dapc-sequence', ['ENABLE_DAPC_SEQUENCE']],
  ['allow', ['DTR0', 'DTR1', 'DTR2', 'TERMINATE', 'ENABLE_DEVICE_TYPE']],
  ['set-max', ['SET_MAX_LEVEL']],
  ['set-min', ['SET_MIN_LEVEL']],
  ['set-scene', ['SET_SCENE', 'SET_SYSTEM_FAILURE_LEVEL']],
  ['set-power-on', ['SET_POWER_ON_LEVEL']],
  ['set-fade', ['SET_FADE_TIME', 'SET_FADE_RATE', 'SET_EXTENDED_FADE_TIME']],
  ['membership', ['REMOVE_FROM_SCENE', 'ADD_TO_GROUP', 'REMOVE_FROM_GROUP']],
  ['gear-writes', ['STORE_ACTUAL_LEVEL_IN_DTR0', 'READ_MEMORY_LOCATION']],
  ['temp-tc', ['DT8_SET_TEMPORARY_TC']],
  ['temp-rgbwaf', ['DT8_SET_TEMPORARY_RGB', 'DT8_SET_TEMPORARY_WAF']],
  ['rgbwaf-control', ['DT8_SET_TEMPORARY_RGBWAF_CONTROL']],
  ['activate', ['DT8_ACTIVATE']],
  ['verified-down', ['DT8_TC_STEP_COOLER', 'DT8_TC_STEP_WARMER', 'DT8_COPY_REPORT_TO_TEMPORARY']],
  [
    'refuse-colour-type',
    [
      'DT8_SET_TEMPORARY_X',
      'DT8_SET_TEMPORARY_Y',
      'DT8_X_STEP_UP',
      'DT8_X_STEP_DOWN',
      'DT8_Y_STEP_UP',
      'DT8_Y_STEP_DOWN',
      'DT8_SET_TEMPORARY_PRIMARY_N',
    ],
  ],
  ['expert', ['DT8_STORE_TC_LIMIT', 'DT8_STORE_GEAR_FEATURES']],
  ['reset', ['RESET']],
  [
    'commissioning',
    [
      'INITIALISE',
      'RANDOMISE',
      'COMPARE',
      'WITHDRAW',
      'SEARCHADDRH',
      'SEARCHADDRM',
      'SEARCHADDRL',
      'PROGRAM_SHORT_ADDRESS',
      'VERIFY_SHORT_ADDRESS',
      'QUERY_SHORT_ADDRESS',
      'SET_SHORT_ADDRESS',
    ],
  ],
  ['expert-curve', ['DT6_SELECT_DIMMING_CURVE']],
  [
    'refuse',
    [
      'IDENTIFY_DEVICE',
      'DT6_ENABLE_CURRENT_PROTECTOR',
      'DT6_DISABLE_CURRENT_PROTECTOR',
      'DT6_STORE_DTR_AS_FAST_FADE_TIME',
      'SET_OPERATING_MODE',
      'DT8_START_AUTO_CALIBRATION',
      'DT6_REFERENCE_SYSTEM_POWER',
      'ENABLE_WRITE_MEMORY',
      'WRITE_MEMORY_LOCATION',
      'WRITE_MEMORY_LOCATION_NO_REPLY',
      'RESET_MEMORY_BANK',
      'DT8_STORE_TY_PRIMARY_N',
      'DT8_STORE_XY_PRIMARY_N',
      'DT8_ASSIGN_COLOUR_TO_LINKED_CHANNEL',
    ],
  ],
];

describe('the rule table (SPEC section 5)', () => {
  it('gives every command the rule of its row', () => {
    for (const [rule, ids] of SPEC_ROWS) {
      for (const id of ids) expect([id, ruleFor(id, false)]).toEqual([id, rule]);
    }
  });
  it('names nothing the spec rows do not, and only commands the codec knows', () => {
    const named = SPEC_ROWS.flatMap(([, ids]) => ids).sort();
    expect(Object.keys(RULES).sort()).toEqual(named);
    for (const id of named) expect([id, hasSpec(id)]).toEqual([id, true]);
  });
  it('is default deny, except for queries', () => {
    expect(ruleFor('QUERY_ACTUAL_LEVEL', true)).toBe('allow');
    expect(ruleFor('NOT_A_COMMAND', false)).toBe('refuse');
    expect(ruleFor('NOT_A_COMMAND', true)).toBe('allow');
    expect(ruleFor('OFF', true)).toBe('off');
  });
});

describe('the sets the governor keys on', () => {
  it('an unverified address accepts DAPC, OFF, queries and DTR writes only', () => {
    expect([...UNVERIFIED_OK].sort()).toEqual(['allow', 'dapc', 'gear-writes', 'off']);
  });
  it('the safety profile writes limits, power-on, failure and colour', () => {
    expect([...PROFILE_WRITES].sort()).toEqual(
      [
        'SET_MAX_LEVEL',
        'SET_MIN_LEVEL',
        'SET_POWER_ON_LEVEL',
        'SET_SYSTEM_FAILURE_LEVEL',
        'DT8_SET_TEMPORARY_TC',
        'DT8_SET_TEMPORARY_RGB',
        'DT8_SET_TEMPORARY_WAF',
      ].sort(),
    );
  });
  it('every level command, RESET, the limits, the curve and colour activation change light', () => {
    expect([...LIGHT_CHANGING].sort()).toEqual(
      [
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
      ].sort(),
    );
    // Every command whose rule is a level rule changes light.
    for (const [id, rule] of Object.entries(RULES)) {
      if (rule === 'dapc' || rule === 'off' || rule === 'verified-up') {
        expect([id, LIGHT_CHANGING.has(id)]).toEqual([id, true]);
      }
    }
  });
  it('group changes and addressing make the inventory stale', () => {
    expect([...STALES_INVENTORY].sort()).toEqual(
      [
        'ADD_TO_GROUP',
        'REMOVE_FROM_GROUP',
        'INITIALISE',
        'RANDOMISE',
        'PROGRAM_SHORT_ADDRESS',
        'SET_SHORT_ADDRESS',
      ].sort(),
    );
  });
});
