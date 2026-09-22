const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { User } = require('./domain');

const ROLES = Object.freeze([
  'event_organiser',
  'event_coordinator',
  'venue_staff',
  'technical_support_staff',
  'attendee'
]);

const jwtSecret = process.env.JWT_SECRET || 'local-development-secret-change-me';

function publicUser(user) {
  return User.fromRow(user).toPublicJSON();
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: '8h' });
}

async function register({ name, email, password, role = 'attendee' }) {
  if (!name || !email || !password || password.length < 8) {
    const error = new Error('Name, email, and a password of at least 8 characters are required');
    error.status = 400;
    throw error;
  }
  if (!['attendee', 'event_organiser'].includes(role)) {
    const error = new Error('Public registration is available for Attendees and Event Organisers only');
    error.status = 400;
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const result = await db.query(
      `INSERT INTO users (name, email, password_hash, role)
      VALUES ($1, lower($2), $3, $4)
       RETURNING id, name, email, role`,
          [name.trim(), email.trim(), passwordHash, role]
    );
    const user = result.rows[0];
    return { user: publicUser(user), token: signToken(user) };
  } catch (error) {
    if (error.code === '23505') {
      error.status = 409;
      error.message = 'An account with that email already exists';
    }
    throw error;
  }
}

async function login({ email, password }) {
  if (!email || !password) {
    const error = new Error('Email and password are required');
    error.status = 400;
    throw error;
  }

  const result = await db.query(
    'SELECT id, name, email, password_hash, role FROM users WHERE lower(email) = lower($1)',
    [email.trim()]
  );
  const user = result.rows[0];
  const valid = user && user.password_hash && await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }
  return { user: publicUser(user), token: signToken(user) };
}

function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.auth = jwt.verify(token, jwtSecret);
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.auth || !allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'You do not have permission to access this resource' });
    }
    next();
  };
}

module.exports = { ROLES, register, login, authenticate, requireRoles };
