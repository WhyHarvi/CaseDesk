import { useEffect, useMemo, useState } from "react";
import { getPublicBookingInfo } from "../../api/bookingApi";

export default function usePortalFreeAppointmentOffer(booking) {
  const [offer, setOffer] = useState(null);
  const bookingToken = useMemo(() => {
    const parts = String(booking?.path || "").split("/").filter(Boolean);
    return parts.at(-1) || "";
  }, [booking?.path]);

  useEffect(() => {
    let active = true;
    setOffer(null);

    if (!booking?.enabled || !bookingToken) return () => { active = false; };

    getPublicBookingInfo(bookingToken)
      .then((result) => {
        if (!active) return;
        const hasConsultationFee = Boolean(
          result?.consultFeeEnabled && Number(result?.consultFeeAmount) > 0,
        );
        const freeFifteenMinuteType = (result?.sessionTypes || []).find(
          (sessionType) => Number(sessionType.durationMinutes) === 15,
        );
        setOffer(
          !hasConsultationFee && freeFifteenMinuteType
            ? { sessionName: freeFifteenMinuteType.name }
            : null,
        );
      })
      .catch(() => {
        // Keep the offer hidden when it cannot be confirmed. The normal
        // appointment booking action remains available in the portal.
      });

    return () => { active = false; };
  }, [booking?.enabled, bookingToken]);

  return offer;
}
