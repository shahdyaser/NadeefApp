import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";

function safeParseInt(value: string | null) {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function getStorageKey(prefix: string, pathname: string) {
  return `${prefix}:${pathname}`;
}

export function useScrollRestoration(prefix: string) {
  const pathname = usePathname();
  const key = useMemo(
    () => getStorageKey(prefix, pathname ?? ""),
    [prefix, pathname],
  );

  const restoredRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const saveNow = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(key, String(window.scrollY ?? 0));
    } catch {
      // ignore
    }
  }, [key]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Restore once per mount.
    if (!restoredRef.current) {
      restoredRef.current = true;
      const saved = safeParseInt(window.sessionStorage.getItem(key));
      if (saved !== null) {
        // Two frames to let content/layout settle.
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            window.scrollTo({ top: saved, left: 0, behavior: "auto" });
          });
        });
      }
    }

    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        saveNow();
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", saveNow);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", saveNow);
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      saveNow();
    };
  }, [key, saveNow]);

  return saveNow;
}

