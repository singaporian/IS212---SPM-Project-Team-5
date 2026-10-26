workspace "ConnectSphere Event Planning and Venue Booking System" "C4 model (C1 System Context and C2 Container) for a monolithic implementation of the first release." {

    # ------------------------------------------------------------------
    # LEGEND
    # Structurizr builds the diagram key/legend automatically from the
    # element styles (see the "styles" block at the bottom). Each colour
    # has its own descriptive tag, and that tag text is the legend label.
    # In the diagram viewer, click the "i" (info) button to show the key.
    # The key is also included when you export the diagram to PNG/SVG.
    # ------------------------------------------------------------------

    model {

        # ------------------------------------------------------------
        # People
        # ------------------------------------------------------------

        # External users
        organiser = person "Event Organiser" "Client representative who has an event to host and provides the event requirements to ConnectSphere." "External user (client or attendee)"
        attendee = person "Attendee" "Participant who registers for and attends a confirmed event." "External user (client or attendee)"

        # Internal users (ConnectSphere staff)
        coordinator = person "Event Coordinator" "Main internal point of contact who reviews requests and coordinates the venue, equipment and confirmation of an event." "Internal user (ConnectSphere staff)"
        venueStaff = person "Venue Staff" "Maintain venue information and availability, and decide on venue booking requests." "Internal user (ConnectSphere staff)"
        techStaff = person "Technical Support Staff" "Maintain equipment records and reservations, and review equipment requests." "Internal user (ConnectSphere staff)"

        # ------------------------------------------------------------
        # Software systems
        # ------------------------------------------------------------

        eventSystem = softwareSystem "ConnectSphere" "Single platform for managing event requests, venue bookings, equipment reservations, attendee registration and notifications." "System being designed" {

            spa = container "Single-Page Application" "Responsive user interface offering role-specific views for event requests, venue search and calendar, equipment, registration and notifications. Delivered to the browser as static files by the Monolithic Application." "JavaScript SPA" "Web UI (runs in browser)"

            app = container "Monolithic Application" "Single deployable that serves the SPA, exposes the REST API and holds all business logic: authentication and access control, event lifecycle, venue and equipment booking, registration, change handling and notifications." "Server-side web framework" "Monolith (single deployable)"

            db = container "Database" "Stores users and roles, events and statuses, venues and bookings, equipment and reservations, registrations and notifications." "Relational database" "Database"
        }

        # ------------------------------------------------------------
        # Relationships - C1 (system level)
        # ------------------------------------------------------------

        organiser -> eventSystem "Submits event requests, tracks status, requests changes and views confirmed arrangements using"
        attendee -> eventSystem "Views events, registers, and withdraws registration using"
        coordinator -> eventSystem "Reviews requests, books venues, records equipment needs, processes changes and confirms events using"
        venueStaff -> eventSystem "Maintains venues and availability, and approves or rejects bookings using"
        techStaff -> eventSystem "Reviews equipment requests, checks availability and reserves equipment using"

        # ------------------------------------------------------------
        # Relationships - C2 (container level)
        # ------------------------------------------------------------

        organiser -> spa "Uses" "HTTPS"
        attendee -> spa "Uses" "HTTPS"
        coordinator -> spa "Uses" "HTTPS"
        venueStaff -> spa "Uses" "HTTPS"
        techStaff -> spa "Uses" "HTTPS"

        spa -> app "Makes API calls to" "JSON/HTTPS"
        app -> db "Reads from and writes to" "SQL/TCP"
    }

    views {

        systemContext eventSystem "C1-SystemContext" "C1: who uses the system and which external systems it depends on." {
            title "C1 - System Context: Event Planning and Venue Booking System"
            include *
            autoLayout lr
        }

        container eventSystem "C2-Containers" "C2: the deployable units of the monolithic system and how they interact." {
            title "C2 - Containers: Event Planning and Venue Booking System (Monolith)"
            include *
            autoLayout lr
        }

        # Each style below = one legend entry. The tag name is the legend label.
        styles {

            # --- People ---
            element "Internal user (ConnectSphere staff)" {
                shape Person
                background #08427b
                color #ffffff
                fontSize 22
            }
            element "External user (client or attendee)" {
                shape Person
                background #0e7c7b
                color #ffffff
                fontSize 22
            }

            # --- Software systems ---
            element "System being designed" {
                background #1168bd
                color #ffffff
            }
            element "External system" {
                background #8a8a8a
                color #ffffff
            }

            # --- Containers ---
            element "Web UI (runs in browser)" {
                shape WebBrowser
                background #438dd5
                color #ffffff
            }
            element "Monolith (single deployable)" {
                shape RoundedBox
                background #1d5fa5
                color #ffffff
            }
            element "Database" {
                shape Cylinder
                background #438dd5
                color #ffffff
            }
        }
    }
}
