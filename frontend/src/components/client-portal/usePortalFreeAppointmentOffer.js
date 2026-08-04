export default function usePortalFreeAppointmentOffer(booking) {
  // Never infer a complimentary offer from public pricing. The authenticated
  // portal overview returns one only after the server verifies a prior paid
  // consultation, remaining allowance, and an active 15-minute session.
  return booking?.enabled ? booking.freeFollowUpOffer || null : null;
}
