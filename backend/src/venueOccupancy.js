// Team policy: venue approval reserves the arrangement, not the overall event.
const OCCUPYING_STATUSES = Object.freeze(['approved', 'confirmed']);
const occupiesVenue = status => OCCUPYING_STATUSES.includes(status);
module.exports = { occupiesVenue };
