import { useCallback, useEffect, useRef } from "react";

export default function useDebouncedAutosave({ value, savedValue = "", enabled = true, delay = 3000, onSave }) {
  const onSaveRef = useRef(onSave);
  const valueRef = useRef(value);
  const savedValueRef = useRef(savedValue);
  const enabledRef = useRef(enabled);
  const timeoutRef = useRef(null);
  const runnerRef = useRef(null);
  const queuedValueRef = useRef(null);
  const lastEnqueuedValueRef = useRef("");

  valueRef.current = value;
  savedValueRef.current = savedValue;
  enabledRef.current = enabled;

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const enqueueSave = useCallback((snapshot) => {
    const nextValue = String(snapshot ?? "").trim();
    if (!nextValue || nextValue === String(savedValueRef.current ?? "").trim()) {
      return runnerRef.current || Promise.resolve(true);
    }

    queuedValueRef.current = snapshot;
    lastEnqueuedValueRef.current = nextValue;
    if (runnerRef.current) return runnerRef.current;

    runnerRef.current = (async () => {
      let succeeded = true;
      while (queuedValueRef.current !== null) {
        const queuedSnapshot = queuedValueRef.current;
        queuedValueRef.current = null;
        const queuedText = String(queuedSnapshot ?? "").trim();
        if (!queuedText || queuedText === String(savedValueRef.current ?? "").trim()) continue;

        // Always persist the exact snapshot that triggered this save. Reading
        // component state here can write an older value while typing continues.
        const result = await onSaveRef.current(queuedSnapshot);
        if (result === false) succeeded = false;

        // Let React publish state updates (including a new note id) before a
        // newer queued snapshot is written.
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      return succeeded;
    })().finally(() => {
      runnerRef.current = null;
      if (queuedValueRef.current !== null) enqueueSave(queuedValueRef.current);
    });

    return runnerRef.current;
  }, []);

  const flush = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (!enabledRef.current) return runnerRef.current || Promise.resolve(true);
    return enqueueSave(valueRef.current);
  }, [enqueueSave]);

  useEffect(() => {
    const nextValue = String(value ?? "").trim();
    if (!enabled || !nextValue || nextValue === String(savedValue ?? "").trim() || nextValue === lastEnqueuedValueRef.current) return undefined;

    // A value changed during an active request is queued immediately instead
    // of waiting through another full debounce window.
    const wait = runnerRef.current ? 0 : delay;
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      enqueueSave(value);
    }, wait);
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [delay, enabled, enqueueSave, savedValue, value]);

  return { flush };
}
