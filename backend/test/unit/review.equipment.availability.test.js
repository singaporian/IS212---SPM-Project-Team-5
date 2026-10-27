// US-022: review technical support requirements, resource decisions, and safety re-review gating logic.
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');

const {
  validateSupportRequirements,
  parseSupportDecision,
  normalizeSupportEquipmentRequirements,
  presentSupportEquipment,
  eventWindowsForAvailability,
  equipmentAvailabilityByRequirement,
  buildSupportEquipmentRequirements,
  requiresTechnicalSafetyReapproval
} = app.__test__;

const EQUIPMENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

test('validateSupportRequirements accepts inventory-linked equipment items', () => {
  const result = validateSupportRequirements({
    equipment: [{ equipmentId: EQUIPMENT_ID, quantity: 3 }],
    staffRequired: 2,
    noSupportRequired: false
  });
  assert.deepEqual(result, {
    equipment: [{ equipmentId: EQUIPMENT_ID, quantity: 3 }],
    staffRequired: 2,
    supportRequired: true
  });
});

test('validateSupportRequirements accepts legacy type payloads for backward compatibility', () => {
  const result = validateSupportRequirements({
    equipment: [{ type: 'Audio', quantity: 2, details: 'Spare handheld mics' }],
    staffRequired: 1,
    noSupportRequired: false
  });
  assert.deepEqual(result.equipment, [{ legacyType: 'Audio', legacyDetails: 'Spare handheld mics', quantity: 2 }]);
});

test('validateSupportRequirements rejects invalid or duplicate equipment entries', () => {
  assert.throws(() => validateSupportRequirements({
    equipment: [{ equipmentId: 'not-a-uuid', quantity: 1 }],
    staffRequired: 1,
    noSupportRequired: false
  }), /valid equipment item/i);
  assert.throws(() => validateSupportRequirements({
    equipment: [{ equipmentId: EQUIPMENT_ID, quantity: 1 }, { equipmentId: EQUIPMENT_ID, quantity: 2 }],
    staffRequired: 1,
    noSupportRequired: false
  }), /only be listed once/i);
  assert.throws(() => validateSupportRequirements({
    equipment: [{ equipmentId: EQUIPMENT_ID, quantity: 0 }],
    staffRequired: 1,
    noSupportRequired: false
  }), /positive whole numbers/i);
});

test('parseSupportDecision maps labels to existing statuses and trims notes', () => {
  assert.deepEqual(parseSupportDecision({ decision: 'Sufficient Resources Available', comments: '  Ready to reserve.  ' }), {
    status: 'confirmed',
    comments: 'Ready to reserve.',
    label: 'Sufficient Resources Available'
  });
  assert.deepEqual(parseSupportDecision({ decision: 'insufficient_resources', comments: '' }), {
    status: 'changes_requested',
    comments: '',
    label: 'Insufficient Resources'
  });
});

test('parseSupportDecision rejects unsupported values and oversized comments', () => {
  assert.throws(() => parseSupportDecision({ decision: 'approved' }), /Decision must be/i);
  assert.throws(() => parseSupportDecision({ decision: 'confirmed', comments: 'x'.repeat(2001) }), /2,000 characters/i);
});

test('normalizeSupportEquipmentRequirements + presentSupportEquipment produce item names for display', () => {
  const normalized = normalizeSupportEquipmentRequirements([
    { equipment_id: EQUIPMENT_ID, equipment_name: 'Wireless Microphone Set', equipment_type: 'Audio', quantity: 4 },
    { type: 'Legacy Cable Kit', quantity: 2 },
    { equipment_id: OTHER_ID, equipment_name: 'Ignored bad quantity', quantity: 0 }
  ]).map(presentSupportEquipment);
  assert.deepEqual(normalized, [
    {
      equipment_id: EQUIPMENT_ID,
      equipment_name: 'Wireless Microphone Set',
      equipment_type: 'Audio',
      quantity: 4,
      type: 'Wireless Microphone Set'
    },
    {
      equipment_id: null,
      equipment_name: 'Legacy Cable Kit',
      equipment_type: 'Legacy Cable Kit',
      quantity: 2,
      type: 'Legacy Cable Kit'
    }
  ]);
});

test('eventWindowsForAvailability uses occupying bookings first, then falls back to event preferred time', () => {
  const fromBookings = eventWindowsForAvailability(
    { preferred_start: '2099-06-01T09:00:00Z', preferred_end: '2099-06-01T11:00:00Z' },
    [{ status: 'pending', start_time: '2099-06-01T09:00:00Z', end_time: '2099-06-01T11:00:00Z' },
      { status: 'approved', start_time: '2099-06-01T10:00:00Z', end_time: '2099-06-01T12:00:00Z' }]
  );
  assert.equal(fromBookings.basis, 'bookings');
  assert.deepEqual(fromBookings.windows, [{ start: '2099-06-01T10:00:00Z', end: '2099-06-01T12:00:00Z' }]);

  const fallback = eventWindowsForAvailability(
    { preferred_start: '2099-07-01T09:00:00Z', preferred_end: '2099-07-01T11:00:00Z' },
    [{ status: 'pending', start_time: '2099-07-01T09:00:00Z', end_time: '2099-07-01T11:00:00Z' }]
  );
  assert.equal(fallback.basis, 'event_preferred_time');
});

test('equipmentAvailabilityByRequirement computes per-item availability with overlapping reservations', async () => {
  const fakeQuery = async (sql) => {
    if (sql.includes('FROM equipment_reservations r')) {
      return {
        rows: [{
          equipment_id: EQUIPMENT_ID,
          quantity: 3,
          event_id: 'event-overlap',
          title: 'Overlap Session',
          windows: [{ start: '2099-08-01T11:00:00Z', end: '2099-08-01T13:00:00Z' }]
        }]
      };
    }
    if (sql.includes('FROM equipment')) {
      return {
        rows: [{
          id: EQUIPMENT_ID,
          name: 'Wireless Microphone Set',
          equipment_type: 'Audio',
          status: 'available',
          total_quantity: 10,
          damaged_quantity: 1,
          maintenance_quantity: 1
        }]
      };
    }
    throw new Error('Unexpected SQL in test fake');
  };

  const result = await equipmentAvailabilityByRequirement(fakeQuery, {
    eventId: 'event-main',
    equipmentRequirements: [{ equipment_id: EQUIPMENT_ID, equipment_name: 'Wireless Microphone Set', equipment_type: 'Audio', quantity: 5 }],
    preferredStart: '2099-08-01T10:00:00Z',
    preferredEnd: '2099-08-01T12:00:00Z',
    bookings: [{ status: 'confirmed', start_time: '2099-08-01T10:00:00Z', end_time: '2099-08-01T12:00:00Z' }]
  });

  assert.equal(result.windowsBasis, 'bookings');
  assert.deepEqual(result.rows[0], {
    key: EQUIPMENT_ID,
    equipment_id: EQUIPMENT_ID,
    equipment_name: 'Wireless Microphone Set',
    equipment_type: 'Audio',
    requested_quantity: 5,
    available_quantity: 5,
    in_service_quantity: 8,
    committed_elsewhere: 3,
    sufficient: true
  });
});

test('buildSupportEquipmentRequirements resolves inventory item names and rejects missing items', async () => {
  const query = async () => ({
    rows: [{ id: EQUIPMENT_ID, name: 'Wireless Microphone Set', equipment_type: 'Audio' }]
  });
  const resolved = await buildSupportEquipmentRequirements(query, [{ equipmentId: EQUIPMENT_ID, quantity: 2 }]);
  assert.deepEqual(resolved, [{ equipment_id: EQUIPMENT_ID, equipment_name: 'Wireless Microphone Set', equipment_type: 'Audio', quantity: 2 }]);

  await assert.rejects(
    () => buildSupportEquipmentRequirements(async () => ({ rows: [] }), [{ equipmentId: EQUIPMENT_ID, quantity: 1 }]),
    error => error.status === 400 && /no longer in the inventory/i.test(error.message)
  );
});

test('requiresTechnicalSafetyReapproval stays true until technical scope is approved', () => {
  assert.equal(requiresTechnicalSafetyReapproval({ safety_status: 'changes_requested', safety_change_scope: ['technical'] }), true);
  assert.equal(requiresTechnicalSafetyReapproval({ safety_status: 'pending', safety_change_scope: ['technical'] }), true);
  assert.equal(requiresTechnicalSafetyReapproval({ safety_status: 'approved', safety_change_scope: ['technical'] }), false);
  assert.equal(requiresTechnicalSafetyReapproval({ safety_status: 'changes_requested', safety_change_scope: ['venue'] }), false);
});
