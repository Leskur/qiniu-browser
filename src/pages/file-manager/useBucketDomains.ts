import { useEffect, useState } from 'react';
import { fetchBucketDomains } from '../../lib/qiniu';
import { useAppStore } from '../../store';

/** Loads account-scoped bucket domains and coordinates the shared domain cache. */
export function useBucketDomains(ak: string, sk: string, bucket: string) {
  const [domains, setDomains] = useState<string[]>([]);
  // ─── Load domain list once with cache ───────────────────────────────────────────────
  useEffect(() => {
    const { getBucketDomains, setBucketDomains } = useAppStore.getState();

    // Check cache first
    const cached = getBucketDomains(bucket);
    if (cached) {
      setDomains(cached);
      return;
    }

    // Fetch from API
    let cancelled = false;
    fetchBucketDomains(ak, sk, bucket)
      .then(domains => {
        if (cancelled) return;
        setDomains(domains);
        setBucketDomains(bucket, domains);
      })
      .catch(() => { if (!cancelled) setDomains([]); });
    return () => { cancelled = true; };
  }, [ak, sk, bucket]);

  return domains;
}
