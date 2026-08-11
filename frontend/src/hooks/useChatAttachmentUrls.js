import { useEffect, useRef, useState } from "react";

// Authenticated attachment file endpoints require a Bearer header, which a
// plain `<img src>` can't send — so image attachments on the staff and
// authenticated-portal chat surfaces are fetched as blobs (through the
// normal api client, which already attaches that header) and rendered via
// an object URL, the same pattern already used for document previews
// elsewhere in this app. The token-link surface doesn't need this at all
// (its file endpoint is authenticated by the token already in the URL
// path), so it just builds a plain URL directly instead of using this hook.
export function useChatAttachmentUrls(messages, fetchBlob) {
  const [urls, setUrls] = useState(() => new Map());
  const urlsRef = useRef(urls);
  urlsRef.current = urls;

  useEffect(() => {
    const imageAttachments = messages.flatMap((message) =>
      (message.attachmentRecords || [])
        .filter((attachment) => (attachment.mimeType || "").startsWith("image/"))
        .map((attachment) => ({ messageId: message.id, attachment })),
    );
    const pending = imageAttachments.filter(({ attachment }) => !urlsRef.current.has(attachment.id));
    if (!pending.length) return undefined;
    let active = true;
    (async () => {
      for (const { messageId, attachment } of pending) {
        const blob = await fetchBlob(messageId, attachment.id).catch(() => null);
        if (!active || !blob) continue;
        const url = URL.createObjectURL(blob);
        setUrls((current) => {
          const next = new Map(current);
          next.set(attachment.id, url);
          return next;
        });
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, fetchBlob]);

  useEffect(
    () => () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  return (attachment) => urls.get(attachment.id);
}
