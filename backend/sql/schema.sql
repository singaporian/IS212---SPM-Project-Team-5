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
  name text NOT NULL,
  location text,
  capacity integer NOT NULL DEFAULT 0,
  facilities jsonb DEFAULT '[]'::jsonb,
  accessibility jsonb DEFAULT '{}',
  supported_layouts jsonb DEFAULT '[]'::jsonb,
  notes text,
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

-- Venue bookings
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  setup_minutes integer DEFAULT 30,
  turnaround_minutes integer DEFAULT 30,
  created_at timestamptz DEFAULT now()
);

-- Equipment inventory
CREATE TABLE IF NOT EXISTS equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  total_quantity integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'available',
  specs jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

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
