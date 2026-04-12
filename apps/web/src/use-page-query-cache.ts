import { useCallback, useRef, useState } from "react";

type CacheEntry<T> = {
  status: "pending" | "ready";
  promise?: Promise<T>;
  value?: T;
};

export function usePageQueryCache() {
  const cacheRef = useRef(new Map<string, CacheEntry<unknown>>());
  const apiRef = useRef<{
    clear: () => void;
    get: <T>(key: string) => T | undefined;
    isPending: (key: string) => boolean;
    load: <T>(key: string, loader: () => Promise<T>) => Promise<T>;
    pendingKeys: Set<string>;
    version: number;
  } | null>(null);
  const generationRef = useRef(0);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(() => new Set());
  const [version, setVersion] = useState(0);

  const clear = useCallback(() => {
    generationRef.current += 1;
    cacheRef.current.clear();
    setPendingKeys(new Set());
    setVersion((current) => current + 1);
  }, []);

  const load = useCallback(
    async <T,>(key: string, loader: () => Promise<T>): Promise<T> => {
      const currentGeneration = generationRef.current;
      const existing = cacheRef.current.get(key) as CacheEntry<T> | undefined;

      if (existing?.status === "ready") {
        return existing.value as T;
      }

      if (existing?.promise) {
        return existing.promise;
      }

      setPendingKeys((current) => {
        if (current.has(key)) {
          return current;
        }

        const next = new Set(current);
        next.add(key);
        return next;
      });

      const promise = loader()
        .then((value) => {
          if (generationRef.current === currentGeneration) {
            cacheRef.current.set(key, { status: "ready", value });
            setVersion((current) => current + 1);
            setPendingKeys((current) => {
              const next = new Set(current);
              next.delete(key);
              return next;
            });
          }

          return value;
        })
        .catch((error) => {
          if (generationRef.current === currentGeneration) {
            cacheRef.current.delete(key);
            setPendingKeys((current) => {
              const next = new Set(current);
              next.delete(key);
              return next;
            });
          }

          throw error;
        });

      cacheRef.current.set(key, {
        status: "pending",
        promise,
      });

      return promise;
    },
    [],
  );

  const get = useCallback(<T,>(key: string): T | undefined => {
    const entry = cacheRef.current.get(key) as CacheEntry<T> | undefined;
    return entry?.status === "ready" ? entry.value : undefined;
  }, []);

  const isPending = useCallback((key: string) => pendingKeys.has(key), [pendingKeys]);

  if (!apiRef.current) {
    apiRef.current = {
      clear,
      get,
      isPending,
      load,
      pendingKeys,
      version,
    };
  }

  apiRef.current.clear = clear;
  apiRef.current.get = get;
  apiRef.current.isPending = isPending;
  apiRef.current.load = load;
  apiRef.current.pendingKeys = pendingKeys;
  apiRef.current.version = version;

  return apiRef.current;
}
