const express = require('express');
const db = require('./db');
const auth = require('./auth');

const EQUIPMENT_TYPES = Object.freeze(['Audio', 'Video & Display', 'Lighting', 'Staging', 'Networking', 'Power & Cabling', 'Furniture', 'Other']);
const MAX_QUANTITY = 2147483647; // largest value the integer column can hold
const MAX_SPECS = 50;

// New equipment always starts as available; the client cannot choose a status.
function validateEquipment(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid equipment details.');

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new Error('Equipment name is required.');
  if (name.length > 200) throw new Error('Equipment name must be at most 200 characters.');

  if (typeof input.type !== 'string' || !input.type) throw new Error('Equipment type is required.');
  if (!EQUIPMENT_TYPES.includes(input.type)) throw new Error('Choose a valid equipment type.');

  const quantity = input.quantity;
  if (quantity === undefined || quantity === null || quantity === '') throw new Error('Quantity is required.');
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a positive whole number.');
  if (quantity > MAX_QUANTITY) throw new Error('Quantity is too large.');

  const rawSpecs = input.specifications ?? {};
  if (typeof rawSpecs !== 'object' || Array.isArray(rawSpecs)) throw new Error('Specifications must be a list of label and value pairs.');
  const entries = Object.entries(rawSpecs);
  if (entries.length > MAX_SPECS) throw new Error('Too many specifications (maximum ' + MAX_SPECS + ').');
  const specifications = {};
  const seen = new Set();
  for (const [rawLabel, rawValue] of entries) {
    const label = rawLabel.trim();
    if (!label) throw new Error('Each specification needs a label.');
    if (typeof rawValue !== 'string' || !rawValue.trim()) throw new Error('Specification "' + label + '" needs a value.');
    if (label.length > 100 || rawValue.trim().length > 500) throw new Error('Specification "' + label.slice(0, 40) + '" is too long.');
    if (seen.has(label.toLowerCase())) throw new Error('Specification "' + label + '" is listed more than once.');
    seen.add(label.toLowerCase());
    specifications[label] = rawValue.trim();
  }

  return { name, type: input.type, quantity, specifications };
}

const router = express.Router();
router.use(auth.authenticate, auth.requireRoles('technical_support_staff'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.post('/', async (req, res) => {
  let data;
  try { data = validateEquipment(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    const result = await db.query(
      `INSERT INTO equipment (name, equipment_type, total_quantity, status, specs)
       VALUES ($1, $2, $3, 'available', $4::jsonb)
       RETURNING id, name, equipment_type, total_quantity, status, specs, created_at`,
      [data.name, data.type, data.quantity, JSON.stringify(data.specifications)]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to save the equipment record. Your input is still available; please retry.' });
  }
});

module.exports = { router, validateEquipment, EQUIPMENT_TYPES };
