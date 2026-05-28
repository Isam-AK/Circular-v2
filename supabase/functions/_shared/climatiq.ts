// ============================================================
// climatiq.ts
//
// Batched, cached lookup of Climatiq emission factors for the
// `climatiq_activity_id`s that come out of spend-carbon.ts.
//
// Climatiq's spend-based EFs are linear in USD (kg CO2e per $1), so
// the factor for an activity_id doesn't depend on amount. We call
// /data/v1/estimate once per unique activity_id with money=1 USD,
// persist the result in public.climatiq_factor_cache, and multiply
// locally for every transaction that uses that activity.
//
// Failure mode is graceful: if Climatiq returns 4xx/5xx, the network
// blows up, the API key is missing, or the activity_id is one of our
// internal sentinels (`circular:*`), we use the hardcoded Phase 2
// factor and record source='fallback' so the UI can later flag it.
// ============================================================

// deno-lint-ignore-file no-explicit-any

const CLIMATIQ_BASE = 'https://api.climatiq.io';
/** Data version selector — caret means "latest minor.patch of v21+". */
const DATA_VERSION = '^21';
/** CEDA is Climatiq's US-region, USD-native spend dataset. EXIOBASE is
 *  EUR-only; using CEDA lets us pass `money_unit: 'usd'` directly. */
const SOURCE = 'CEDA';
const REGION = 'US';
/** How long a cached factor stays valid before we re-fetch it. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface FactorResult {
  kgPerUsd: number;
  /** `climatiq:<emission-factor-source>` for live hits, `fallback` otherwise. */
  source: string;
}

interface CacheRow {
  activity_id: string;
  kg_per_usd: number | string;
  source: string;
  fetched_at: string;
}

/**
 * Resolve emission factors for every activity_id in `activityIds`. The
 * returned map has one entry per *unique* input id.
 *
 * @param activityIds        Activity ids from spend-carbon classification.
 *                           Duplicates are deduped internally.
 * @param supabase           A *service-role* Supabase client. The cache
 *                           table has no RLS policy for end users.
 * @param fallbackFor        Returns the Phase 2 hardcoded kgPerUsd for a
 *                           given activity_id. Used whenever Climatiq
 *                           can't / won't give us a live number.
 */
export async function getFactors(
  activityIds: string[],
  supabase: any,
  fallbackFor: (activityId: string) => number,
): Promise<Map<string, FactorResult>> {
  const out = new Map<string, FactorResult>();
  const unique = Array.from(new Set(activityIds)).filter((id) => id.length > 0);
  if (unique.length === 0) return out;

  // 1. Pull fresh cache rows in a single round-trip.
  const cacheMap = new Map<string, FactorResult>();
  const { data: cached, error: cacheError } = await supabase
    .from('climatiq_factor_cache')
    .select('activity_id, kg_per_usd, source, fetched_at')
    .in('activity_id', unique);

  if (cacheError) {
    console.warn('[climatiq] cache read failed:', cacheError.message);
  } else if (cached) {
    const now = Date.now();
    for (const row of cached as CacheRow[]) {
      const fetchedAt = new Date(row.fetched_at).getTime();
      if (now - fetchedAt < CACHE_TTL_MS) {
        cacheMap.set(row.activity_id, {
          kgPerUsd: Number(row.kg_per_usd),
          source: row.source,
        });
      }
    }
  }

  // 2. Separate cache hits from misses.
  const toFetch: string[] = [];
  for (const id of unique) {
    const hit = cacheMap.get(id);
    if (hit) {
      out.set(id, hit);
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length === 0) return out;

  // 3. Hit Climatiq for each cache miss in parallel.
  const apiKey = Deno.env.get('CLIMATIQ_API_KEY');
  const fetched = await Promise.all(
    toFetch.map(async (id) => ({ id, result: await fetchOne(id, apiKey, fallbackFor) })),
  );

  // 4. Persist the new rows so future syncs don't re-hit Climatiq for
  //    the same activities. Negative results are cached too — that's
  //    fine because the activity ids are hardcoded, so a "bad" id
  //    will be bad on every subsequent sync until we update the
  //    classifier.
  const upsertRows = fetched.map(({ id, result }) => ({
    activity_id: id,
    kg_per_usd: result.kgPerUsd,
    source: result.source,
    fetched_at: new Date().toISOString(),
  }));
  const { error: upsertError } = await supabase
    .from('climatiq_factor_cache')
    .upsert(upsertRows, { onConflict: 'activity_id' });
  if (upsertError) {
    console.warn('[climatiq] cache upsert failed:', upsertError.message);
  }

  for (const { id, result } of fetched) {
    out.set(id, result);
  }
  return out;
}

/** Single-activity Climatiq estimate call, with graceful fallback. */
async function fetchOne(
  activityId: string,
  apiKey: string | undefined,
  fallbackFor: (activityId: string) => number,
): Promise<FactorResult> {
  // Our internal sentinel ids (`circular:no-impact`, `circular:micromobility`)
  // aren't real Climatiq activity ids — short-circuit to the fallback
  // without making the API call.
  if (activityId.startsWith('circular:')) {
    return { kgPerUsd: fallbackFor(activityId), source: 'fallback' };
  }
  if (!apiKey) {
    console.warn('[climatiq] CLIMATIQ_API_KEY not set; using fallback');
    return { kgPerUsd: fallbackFor(activityId), source: 'fallback' };
  }

  try {
    const res = await fetch(`${CLIMATIQ_BASE}/data/v1/estimate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Pin source + region so Climatiq picks the CEDA US factor
        // even if the same activity_id exists across multiple
        // datasets in future data_versions.
        emission_factor: {
          activity_id: activityId,
          data_version: DATA_VERSION,
          source: SOURCE,
          region: REGION,
        },
        parameters: { money: 1, money_unit: 'usd' },
      }),
    });

    if (!res.ok) {
      // 404 means activity_id is unknown to Climatiq — common for our
      // placeholder ids. 401/403 mean auth misconfig. 5xx means
      // Climatiq is having a moment. All three: fall back.
      const text = await res.text().catch(() => '');
      console.warn(
        `[climatiq] ${activityId} -> HTTP ${res.status}; using fallback. body=${text.slice(0, 200)}`,
      );
      return { kgPerUsd: fallbackFor(activityId), source: 'fallback' };
    }

    const body: any = await res.json();
    const co2e = Number(body?.co2e);
    if (!Number.isFinite(co2e) || co2e < 0) {
      console.warn(`[climatiq] ${activityId} -> invalid co2e:`, body?.co2e);
      return { kgPerUsd: fallbackFor(activityId), source: 'fallback' };
    }
    // co2e is for money=1 USD, so this *is* kg per USD directly.
    const efSource = String(body?.emission_factor?.source ?? 'climatiq');
    return { kgPerUsd: co2e, source: `climatiq:${efSource}` };
  } catch (e) {
    console.warn(`[climatiq] ${activityId} fetch error:`, (e as Error).message);
    return { kgPerUsd: fallbackFor(activityId), source: 'fallback' };
  }
}
