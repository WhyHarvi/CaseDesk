import { useEffect, useState } from "react";
import api from "../../services/api";

export default function StaffAvatar({ user, className = "h-10 w-10", alt = "" }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    let objectUrl = "";
    api.get(`/internal-chat/users/${user.id}/avatar`, { responseType: "blob", skipCache: true })
      .then((response) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(response.data);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(`/staff-avatars/${user.avatarPreset || "avatar-1"}.png`));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [user?.id, user?.avatarPreset]);

  return <img src={url || `/staff-avatars/${user?.avatarPreset || "avatar-1"}.png`} alt={alt} className={`${className} rounded-full object-cover`} />;
}
