// US-033: validate decision input without database access. Availability is rechecked in the transaction.
function parseBookingDecision(body) {
  const { decision, reason = '', comment = '', alternativeStartTime, alternativeEndTime } = body || {};
  const invalid = message => Object.assign(new Error(message), { status: 400 });
  if (!['approved', 'rejected', 'alternative_suggested'].includes(decision)) throw invalid('Invalid booking decision');
  if (typeof reason !== 'string' || typeof comment !== 'string') throw invalid('Decision information must be text');
  let alternativeStart = null, alternativeEnd = null;
  if (decision === 'alternative_suggested') {
    alternativeStart = new Date(alternativeStartTime);
    alternativeEnd = new Date(alternativeEndTime);
    if (!alternativeStartTime || !alternativeEndTime || !Number.isFinite(+alternativeStart) || !Number.isFinite(+alternativeEnd) || alternativeEnd <= alternativeStart)
      throw invalid('Enter a valid alternative end after its start.');
  }
  return { decision, reason: reason.trim(), comment: comment.trim(), alternativeStart, alternativeEnd };
}

module.exports = { parseBookingDecision };
