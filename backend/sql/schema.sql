-- ConnectSphere SQL schema (core entities)
-- This script is designed to be idempotent where possible.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text,
  role text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Venues
CREATE TABLE IF NOT EXISTS venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  location text,
  capacity integer NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  facilities jsonb DEFAULT '[]'::jsonb,
  accessibility jsonb DEFAULT '{}',
  supported_layouts jsonb DEFAULT '[]'::jsonb,
  available_from date NOT NULL DEFAULT '2026-09-13',
  available_until date NOT NULL DEFAULT '2027-01-31',
  CHECK (available_until >= available_from),
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE venues ADD COLUMN IF NOT EXISTS available_from date NOT NULL DEFAULT '2026-09-13';
ALTER TABLE venues ADD COLUMN IF NOT EXISTS available_until date NOT NULL DEFAULT '2027-01-31';
ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_available_dates_check;
ALTER TABLE venues ADD CONSTRAINT venues_available_dates_check CHECK (available_until >= available_from);

CREATE UNIQUE INDEX IF NOT EXISTS venues_name_unique ON venues (name);

-- Recurring venue operating hours. day_of_week follows PostgreSQL EXTRACT(DOW): Sunday = 0.
CREATE TABLE IF NOT EXISTS venue_operating_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  CHECK (closes_at > opens_at),
  UNIQUE (venue_id, day_of_week)
);

-- Venue gallery images are stored as URLs so the database does not contain binary media.
CREATE TABLE IF NOT EXISTS venue_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  alt_text text,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Events (including drafts)
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organiser_id uuid REFERENCES users(id) ON DELETE SET NULL,
  title text NOT NULL,
  event_type text,
  preferred_start timestamptz,
  preferred_end timestamptz,
  expected_attendance integer,
  purpose text,
  venue_layout_preference text,
  accessibility_requirements jsonb DEFAULT '{}',
  equipment_requirements jsonb DEFAULT '[]'::jsonb,
  programme text,
  registration_required boolean DEFAULT false,
  special_arrangements text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Coordinator assignment for event requests (added for US-011 / US-012)
ALTER TABLE events ADD COLUMN IF NOT EXISTS assigned_coordinator_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- Preserve incomplete draft fields without coercing dates, placeholders or tri-state choices.
ALTER TABLE events ADD COLUMN IF NOT EXISTS draft_data jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Latest technical support requirements for each event (US-016).
CREATE TABLE IF NOT EXISTS technical_support_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  equipment_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  staff_required integer NOT NULL DEFAULT 0 CHECK (staff_required >= 0),
  late_request boolean NOT NULL DEFAULT false,
  update_count integer NOT NULL DEFAULT 0 CHECK (update_count >= 0),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE technical_support_requirements ADD COLUMN IF NOT EXISTS update_count integer NOT NULL DEFAULT 0;

-- Venue bookings
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  setup_minutes integer NOT NULL DEFAULT 30 CHECK (setup_minutes >= 0),
  turnaround_minutes integer NOT NULL DEFAULT 30 CHECK (turnaround_minutes >= 0),
  venue_requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  conflict_warning boolean NOT NULL DEFAULT false,
  conflict_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_reason text,
  decision_comment text,
  alternative_start_time timestamptz,
  alternative_end_time timestamptz,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  CHECK (end_time > start_time),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS venue_requirements jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS conflict_warning boolean NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS conflict_details jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS decision_reason text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS decision_comment text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS alternative_start_time timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS alternative_end_time timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS decided_at timestamptz;

-- Equipment inventory
CREATE TABLE IF NOT EXISTS equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  total_quantity integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'available',
  specs jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Equipment category (added for the "add equipment to inventory" story)
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS equipment_type text;

-- Equipment reservations per event
CREATE TABLE IF NOT EXISTS equipment_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid REFERENCES equipment(id) ON DELETE CASCADE,
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Attendee registrations
CREATE TABLE IF NOT EXISTS registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'registered',
  created_at timestamptz DEFAULT now()
);

-- Venue unavailability periods (maintenance)
CREATE TABLE IF NOT EXISTS venue_unavailabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid REFERENCES venues(id) ON DELETE CASCADE,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  reason text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Simple notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  message text NOT NULL,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Audit table for event changes
CREATE TABLE IF NOT EXISTS event_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  change_summary text,
  created_at timestamptz DEFAULT now()
);

-- Organiser-submitted proposed changes to an already-submitted event
CREATE TABLE IF NOT EXISTS event_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organiser_id uuid NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  proposed_changes jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_change_requests_event_idx ON event_change_requests (event_id);