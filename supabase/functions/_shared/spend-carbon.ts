// ============================================================
// spend-carbon.ts
//
// Plaid Personal Finance Category → kg CO₂e per USD spend.
//
// Two-level classification:
//   1. `DETAILED_OVERRIDES` keyed by `personal_finance_category.detailed`
//      (e.g. TRAVEL_FLIGHTS, GENERAL_MERCHANDISE_ELECTRONICS) — used when
//      we have a tighter factor / different DB category than the primary
//      group implies. This is what lets us bill flights as air-transport
//      while still bucketing ride-shares as road-transport.
//   2. `PRIMARY_FACTORS` keyed by `personal_finance_category.primary` —
//      the fallback when no detailed override matches.
//
// Values are USA-region spend-based emission factors derived from
// Climatiq's EXIOBASE datasets, rounded to ~3 sig figs. Each entry
// includes the Climatiq `activity_id` we'd hit if/when we swap the
// hardcoded factor for a live API estimate (Phase 3).
//
// "No-impact" categories (income, transfers, fees, loans) flow through
// with kgPerUsd = 0 — they're surfaced in the UI but don't count toward
// the carbon score.
// ============================================================

/** Supabase enum `public.transaction_category`. Keep this in sync with schema.sql. */
export type DbCategory =
  | 'food'
  | 'transport'
  | 'housing'
  | 'clothing'
  | 'electronics'
  | 'services'
  | 'entertainment'
  | 'utilities'
  | 'other';

export interface CategoryFactor {
  /** kg CO₂e per 1 USD of spend. Zero means "no carbon impact" (transfers, etc). */
  kgPerUsd: number;
  /** Climatiq activity_id that would be used for a live estimate. */
  activityId: string;
}

interface CategoryMapping extends CategoryFactor {
  dbCategory: DbCategory;
}

/** Fallback table keyed by `personal_finance_category.primary`. */
const PRIMARY_FACTORS: Record<string, CategoryMapping> = {
  // Real spend — counts toward footprint
  FOOD_AND_DRINK:           { dbCategory: 'food',          kgPerUsd: 0.42,  activityId: 'consumer_goods-type_food_beverages_tobacco' },
  GENERAL_MERCHANDISE:      { dbCategory: 'other',         kgPerUsd: 0.36,  activityId: 'consumer_goods-type_other_manufactured_goods' },
  HOME_IMPROVEMENT:         { dbCategory: 'housing',       kgPerUsd: 0.48,  activityId: 'construction-type_residential_buildings' },
  PERSONAL_CARE:            { dbCategory: 'services',      kgPerUsd: 0.22,  activityId: 'services-type_other_services' },
  GENERAL_SERVICES:         { dbCategory: 'services',      kgPerUsd: 0.22,  activityId: 'services-type_other_services' },
  MEDICAL:                  { dbCategory: 'services',      kgPerUsd: 0.18,  activityId: 'services-type_health_social_work' },
  ENTERTAINMENT:            { dbCategory: 'entertainment', kgPerUsd: 0.16,  activityId: 'services-type_recreational_cultural_sporting' },
  TRANSPORTATION:           { dbCategory: 'transport',     kgPerUsd: 0.32,  activityId: 'transport_services-type_passenger_road_transport' },
  TRAVEL:                   { dbCategory: 'transport',     kgPerUsd: 0.55,  activityId: 'transport_services-type_passenger_air_transport' },
  RENT_AND_UTILITIES:       { dbCategory: 'utilities',     kgPerUsd: 0.62,  activityId: 'electricity-supply_grid-source_residual_mix' },
  GOVERNMENT_AND_NON_PROFIT:{ dbCategory: 'services',      kgPerUsd: 0.20,  activityId: 'services-type_public_administration_defense' },

  // Non-consumption — passes through with 0 carbon
  INCOME:                   { dbCategory: 'other',         kgPerUsd: 0.0,   activityId: 'circular:no-impact' },
  TRANSFER_IN:              { dbCategory: 'other',         kgPerUsd: 0.0,   activityId: 'circular:no-impact' },
  TRANSFER_OUT:             { dbCategory: 'other',         kgPerUsd: 0.0,   activityId: 'circular:no-impact' },
  LOAN_PAYMENTS:            { dbCategory: 'other',         kgPerUsd: 0.0,   activityId: 'circular:no-impact' },
  BANK_FEES:                { dbCategory: 'other',         kgPerUsd: 0.0,   activityId: 'circular:no-impact' },
};

/** Overrides keyed by `personal_finance_category.detailed`. Anything
 *  not listed here falls through to PRIMARY_FACTORS. The keys are
 *  Plaid's canonical detailed enum values (uppercase snake_case). */
const DETAILED_OVERRIDES: Record<string, CategoryMapping> = {
  // ── Travel: split flights from ground / lodging ──
  TRAVEL_FLIGHTS:                  { dbCategory: 'transport', kgPerUsd: 0.55, activityId: 'transport_services-type_passenger_air_transport' },
  TRAVEL_RENTAL_CARS:              { dbCategory: 'transport', kgPerUsd: 0.32, activityId: 'transport_services-type_passenger_road_transport' },
  TRAVEL_LODGING:                  { dbCategory: 'services',  kgPerUsd: 0.45, activityId: 'accommodation-type_hotels' },
  TRAVEL_OTHER_TRAVEL:             { dbCategory: 'transport', kgPerUsd: 0.40, activityId: 'transport_services-type_passenger_road_transport' },

  // ── Transportation: gas heavier, transit lighter ──
  TRANSPORTATION_GAS:              { dbCategory: 'transport', kgPerUsd: 0.40, activityId: 'fuel-type_motor_gasoline' },
  TRANSPORTATION_PUBLIC_TRANSIT:   { dbCategory: 'transport', kgPerUsd: 0.10, activityId: 'transport_services-type_passenger_rail_transport' },
  TRANSPORTATION_BIKES_AND_SCOOTERS:{ dbCategory: 'transport', kgPerUsd: 0.02, activityId: 'circular:micromobility' },
  TRANSPORTATION_TAXIS_AND_RIDE_SHARES:{ dbCategory: 'transport', kgPerUsd: 0.32, activityId: 'transport_services-type_passenger_road_transport' },
  TRANSPORTATION_PARKING:          { dbCategory: 'transport', kgPerUsd: 0.05, activityId: 'services-type_other_services' },
  TRANSPORTATION_TOLLS:            { dbCategory: 'transport', kgPerUsd: 0.05, activityId: 'services-type_other_services' },

  // ── General merchandise: pull electronics + clothing into proper buckets ──
  GENERAL_MERCHANDISE_ELECTRONICS:             { dbCategory: 'electronics', kgPerUsd: 0.42, activityId: 'consumer_goods-type_electrical_equipment' },
  GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES:{ dbCategory: 'clothing',    kgPerUsd: 0.36, activityId: 'consumer_goods-type_textiles' },
  GENERAL_MERCHANDISE_SPORTING_GOODS:          { dbCategory: 'other',       kgPerUsd: 0.36, activityId: 'consumer_goods-type_other_manufactured_goods' },
  GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS:{ dbCategory: 'other',      kgPerUsd: 0.20, activityId: 'consumer_goods-type_paper_products' },
  GENERAL_MERCHANDISE_PET_SUPPLIES:            { dbCategory: 'other',       kgPerUsd: 0.36, activityId: 'consumer_goods-type_other_manufactured_goods' },
  GENERAL_MERCHANDISE_OFFICE_SUPPLIES:         { dbCategory: 'other',       kgPerUsd: 0.32, activityId: 'consumer_goods-type_paper_products' },

  // ── Food: groceries / coffee / fast food split ──
  FOOD_AND_DRINK_GROCERIES:        { dbCategory: 'food', kgPerUsd: 0.38, activityId: 'consumer_goods-type_food_beverages_tobacco' },
  FOOD_AND_DRINK_RESTAURANT:       { dbCategory: 'food', kgPerUsd: 0.48, activityId: 'services-type_restaurants_food_services' },
  FOOD_AND_DRINK_FAST_FOOD:        { dbCategory: 'food', kgPerUsd: 0.55, activityId: 'services-type_restaurants_food_services' },
  FOOD_AND_DRINK_COFFEE:           { dbCategory: 'food', kgPerUsd: 0.32, activityId: 'consumer_goods-type_food_beverages_tobacco' },
  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR:{ dbCategory: 'food', kgPerUsd: 0.45, activityId: 'consumer_goods-type_food_beverages_tobacco' },

  // ── Rent / utilities split for clarity ──
  RENT_AND_UTILITIES_GAS_AND_ELECTRICITY:{ dbCategory: 'utilities', kgPerUsd: 0.62, activityId: 'electricity-supply_grid-source_residual_mix' },
  RENT_AND_UTILITIES_WATER:              { dbCategory: 'utilities', kgPerUsd: 0.18, activityId: 'water_supply' },
  RENT_AND_UTILITIES_RENT:               { dbCategory: 'housing',   kgPerUsd: 0.0,  activityId: 'circular:no-impact' }, // rent itself is a transfer, no consumption carbon
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: { dbCategory: 'utilities', kgPerUsd: 0.12, activityId: 'services-type_telecommunications' },
};

const DEFAULT_MAPPING: CategoryMapping = {
  dbCategory: 'other',
  kgPerUsd: 0.30,
  activityId: 'consumer_goods-type_other_manufactured_goods',
};

/**
 * Map a Plaid transaction's personal_finance_category to our DB category +
 * carbon factor. Prefers `detailed` (e.g. TRAVEL_FLIGHTS) when present and
 * known, falls back to `primary`, then to a generic catch-all.
 */
export function classifyTransaction(
  detailed: string | null | undefined,
  primary: string | null | undefined,
): CategoryMapping {
  const detailedKey = (detailed ?? '').toUpperCase();
  if (detailedKey && DETAILED_OVERRIDES[detailedKey]) {
    return DETAILED_OVERRIDES[detailedKey];
  }

  const primaryKey = (primary ?? '').toUpperCase();
  if (primaryKey && PRIMARY_FACTORS[primaryKey]) {
    return PRIMARY_FACTORS[primaryKey];
  }

  return DEFAULT_MAPPING;
}

/**
 * @deprecated Phase-2-era primary-only classifier. Kept as a thin wrapper
 * for back-compat — new callers should use `classifyTransaction(detailed,
 * primary)` so sub-category overrides apply.
 */
export function classify(primary: string | null | undefined): {
  dbCategory: DbCategory;
  factor: CategoryFactor;
} {
  const m = classifyTransaction(null, primary);
  return { dbCategory: m.dbCategory, factor: { kgPerUsd: m.kgPerUsd, activityId: m.activityId } };
}
