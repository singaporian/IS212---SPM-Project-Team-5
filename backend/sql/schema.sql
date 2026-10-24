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

-- US-017 (Week 7 customer change #1): configurable per-venue setup/turnaround defaults.
-- US-035: Venue Staff configure these same defaults directly, used when determining
-- availability (searching for venues and reviewing booking requests).
ALTER TABLE venues ADD COLUMN IF NOT EXISTS default_setup_minutes integer NOT NULL DEFAULT 30 CHECK (default_setup_minutes >= 0);
ALTER TABLE venues ADD COLUMN IF NOT EXISTS default_turnaround_minutes integer NOT NULL DEFAULT 30 CHECK (default_turnaround_minutes >= 0);

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

-- Current coordinator for each event request: set by the Event Coordinator Lead (US-034), enforced by coordinator routes (US-012)
ALTER TABLE events ADD COLUMN IF NOT EXISTS assigned_coordinator_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- US-031: the Coordinator's note when returning a request for clarification (optional).
ALTER TABLE events ADD COLUMN IF NOT EXISTS clarification_note text;

-- Preserve incomplete draft fields without coercing dates, placeholders or tri-state choices.
ALTER TABLE events ADD COLUMN IF NOT EXISTS draft_data jsonb NOT NULL DEFAULT '{}'::jsonb;

-- US-039: one auditable operational safety decision per event.
CREATE TABLE IF NOT EXISTS operational_safety_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested')),
  change_scope text[] NOT NULL DEFAULT '{}'::text[],
  comments text,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE operational_safety_checks ADD COLUMN IF NOT EXISTS change_scope text[] NOT NULL DEFAULT '{}'::text[];

-- US-006: submission preserves the draft snapshot and exposes review fields.
ALTER TABLE events ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- Latest technical support requirements for each event (US-016).
CREATE TABLE IF NOT EXISTS technical_support_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  equipment_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  staff_required integer NOT NULL DEFAULT 0 CHECK (staff_required >= 0),
  support_required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'changes_requested')),
  decision_comments text,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  late_request boolean NOT NULL DEFAULT false,
  update_count integer NOT NULL DEFAULT 0 CHECK (update_count >= 0),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE technical_support_requirements ADD COLUMN IF NOT EXISTS update_count integer NOT NULL DEFAULT 0;
ALTER TABLE technical_support_requirements ADD COLUMN IF NOT EXISTS support_required boolean NOT NULL DEFAULT true;
ALTER TABLE technical_support_requirements ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE technical_support_requirements ADD COLUMN IF NOT EXISTS decision_comments text;
ALTER TABLE technical_support_requirements ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE technical_support_requirements ADD COLUMN IF NOT EXISTS decided_at timestamptz;

-- Venue bookings
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  replacement_for_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  required_capacity integer CHECK (required_capacity IS NULL OR required_capacity > 0),
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

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS replacement_for_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS required_capacity integer;
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

-- US-024: units out of service. Only total - damaged - maintenance units can be reserved for events.
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS damaged_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS maintenance_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_out_of_service_within_total;
ALTER TABLE equipment ADD CONSTRAINT equipment_out_of_service_within_total
  CHECK (damaged_quantity >= 0 AND maintenance_quantity >= 0 AND damaged_quantity + maintenance_quantity <= total_quantity);

-- Equipment reservations per event
CREATE TABLE IF NOT EXISTS equipment_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid REFERENCES equipment(id) ON DELETE CASCADE,
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- US-023: one reservation row per equipment item per event; deleting the row returns its units to stock.
ALTER TABLE equipment_reservations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'reserved';
ALTER TABLE equipment_reservations ADD COLUMN IF NOT EXISTS reserved_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE equipment_reservations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE equipment_reservations DROP CONSTRAINT IF EXISTS equipment_reservations_quantity_positive;
ALTER TABLE equipment_reservations ADD CONSTRAINT equipment_reservations_quantity_positive CHECK (quantity > 0);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_reservations_equipment_event_unique ON equipment_reservations (equipment_id, event_id);

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

-- US-029/US-030: who registered (so an Attendee can view/withdraw their own registration),
-- and when the registration status last changed.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS attendee_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- One active ("registered") registration per attendee per event; a withdrawn row doesn't
-- block a later re-registration, since it no longer matches this partial index.
CREATE UNIQUE INDEX IF NOT EXISTS registrations_event_attendee_active_unique
  ON registrations (event_id, attendee_id)
  WHERE attendee_id IS NOT NULL AND status = 'registered';

-- US-029: registration capacity and window for a confirmed event open to Attendee registration.
-- A NULL capacity means unlimited; NULL opens/closes means no restriction on that side.
ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_capacity integer CHECK (registration_capacity IS NULL OR registration_capacity > 0);
ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_opens_at timestamptz;
ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_closes_at timestamptz;

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

-- US-020: reason dropdown code, who/when it was last modified, and whether it was ended early.
ALTER TABLE venue_unavailabilities ADD COLUMN IF NOT EXISTS reason_code text;
ALTER TABLE venue_unavailabilities ADD COLUMN IF NOT EXISTS modified_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE venue_unavailabilities ADD COLUMN IF NOT EXISTS modified_at timestamptz;
ALTER TABLE venue_unavailabilities ADD COLUMN IF NOT EXISTS ended_early boolean NOT NULL DEFAULT false;
UPDATE venue_unavailabilities SET reason_code = 'other' WHERE reason_code IS NULL;

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

-- US-032: who decided a change request and when; arrangements to reconsider after an approved move.
-- Flags only identify affected arrangements; booking/reservation status is never changed by them.
ALTER TABLE event_change_requests ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE event_change_requests ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS requires_reconsideration boolean NOT NULL DEFAULT false;
ALTER TABLE equipment_reservations ADD COLUMN IF NOT EXISTS requires_reconsideration boolean NOT NULL DEFAULT false;

-- US-038: holds reference an existing request; no duplicate booking is created.
CREATE TABLE IF NOT EXISTS venue_holds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 booking_id uuid NOT NULL REFERENCES bookings(id),
 event_id uuid NOT NULL REFERENCES events(id),
 venue_id uuid NOT NULL REFERENCES venues(id),
 start_time timestamptz NOT NULL,
 end_time timestamptz NOT NULL CHECK (end_time > start_time),
 setup_minutes integer NOT NULL DEFAULT 0 CHECK (setup_minutes >= 0),
 turnaround_minutes integer NOT NULL DEFAULT 0 CHECK (turnaround_minutes >= 0),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released')),
 expiry_at timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expiry_notified_at timestamptz
);
CREATE INDEX IF NOT EXISTS venue_holds_availability ON venue_holds (venue_id, expiry_at) WHERE status = 'active';
-- Upgrade the earlier local US-038 draft without deleting existing hold/history data.
ALTER TABLE venue_holds DROP CONSTRAINT IF EXISTS venue_holds_check1;
ALTER TABLE venue_holds ADD COLUMN IF NOT EXISTS expiry_notified_at timestamptz;


ALTER TABLE bookings ADD COLUMN IF NOT EXISTS preparation_status text NOT NULL DEFAULT 'not_started'; -- US-021: preparation status per venue booking (Week 7 #3: each venue of an event is independent).
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_preparation_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_preparation_status_check
  CHECK (preparation_status IN ('not_started', 'in_progress', 'ready'));
