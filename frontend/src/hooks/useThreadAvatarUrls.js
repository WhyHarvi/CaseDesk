import { useEffect, useRef, useState } from "react";

// Same blob-fetch + object-URL cache pattern as useChatAttachmentUrls —
// group avatars sit behind the same authenticated file endpoint every
// other file in this app does, so a plain <img src> can't be used. Takes
// any list of {id, hasAvatar} items (thread rows, or a single active
// thread wrapped in an array) and a fetcher keyed by thread id.
export function useThreadAvatarUrls(items, fetchBlob) {
  const [urls, setUrls] = useState(() => new Map());
  const urlsRef = useRef(urls);
  urlsRef.current = urls;

  useEffect(() => {
    const withAvatars = items.filter((item) => item?.hasAvatar && item.id);
    const pending = withAvatars.filter((item) => !urlsRef.current.has(item.id));
    if (!pending.length) return undefined;
    let active = true;
    (async () => {
      for (const item of pending) {
        const blob = await fetchBlob(item.id).catch(() => null);
        if (!active || !blob) continue;
        const url = URL.createObjectURL(blob);
        setUrls((current) => {
          const next = new Map(current);
          next.set(item.id, url);
          return next;
        });
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, fetchBlob]);

  useEffect(
    () => () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  // Evicts a single cached URL so the next render re-fetches it — needed
  // after a group photo is replaced, since the cache above is otherwise
  // "fetch once per id, forever."
  function refresh(id) {
    setUrls((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      const oldUrl = next.get(id);
      next.delete(id);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      return next;
    });
  }

  const urlFor = (item) => (item ? urls.get(item.id) : undefined);
  return [urlFor, refresh];
}
