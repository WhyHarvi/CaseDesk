import { useEffect, useRef } from "react";

export default function useDebouncedAutosave({ value, savedValue = "", enabled = true, delay = 3000, onSave }) {
  const onSaveRef = useRef(onSave);
  const previousValueRef = useRef(value);
  const attemptedValueRef = useRef("");

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    const nextValue = value.trim();
    if (value !== previousValueRef.current) {
      previousValueRef.current = value;
      attemptedValueRef.current = "";
    }
    if (!enabled || !nextValue || nextValue === savedValue.trim() || nextValue === attemptedValueRef.current) return undefined;

    const timeout = window.setTimeout(() => {
      attemptedValueRef.current = nextValue;
      onSaveRef.current();
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [delay, enabled, savedValue, value]);
}
