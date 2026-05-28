// ============================================================
// spend-carbon.ts
//
// Plaid Personal Finance Category → CEDA (US-region, USD-native)
// emission factor activity_id.
//
// Two-level classification:
//   1. `DETAILED_OVERRIDES` keyed by `personal_finance_category.detailed`
//      (e.g. TRAVEL_FLIGHTS, GENERAL_MERCHANDISE_ELECTRONICS) — used when
//      we have a tighter activity_id than the primary group implies.
//   2. `PRIMARY_FACTORS` keyed by `personal_finance_category.primary` —
//      the fallback when no detailed override matches.
//
// Activity IDs come from Climatiq's CEDA dataset (US, kg/usd). The
// `-price_purchaser` suffix means the factor includes retail markup,
// which is the right boundary for consumer card spending. The
// `kgPerUsd` value on each row is a *conservative fallback* used only
// when Climatiq is unreachable or returns no match — Phase 3's live
// lookup will override it with the canonical CEDA factor whenever
// possible. Values are derived from Climatiq CEDA 2024/2025 spot
// checks, rounded to ~3 sig figs.
//
// "No-impact" categories (income, transfers, fees, loans, rent itself)
// flow through with kgPerUsd = 0 and the sentinel activity_id
// `circular:no-impact` — they're surfaced in the UI but don't count
// toward the carbon score.
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
  /** Climatiq CEDA activity_id (with `-price_purchaser` suffix where applicable). */
  activityId: string;
}

interface CategoryMapping extends CategoryFactor {
  dbCategory: DbCategory;
}

// Canonical CEDA activity ids — defined once and reused to keep the
// tables below readable and the mapping consistent.
const CEDA = {
  restaurant_full:    'consumer_services-type_full_service_restaurants-price_purchaser',
  restaurant_limited: 'consumer_services-type_limited_service_restaurants-price_purchaser',
  food_bev_stores:    'general_retail-type_food_and_beverage_stores-price_purchaser',
  gen_merchandise:    'general_retail-type_general_merchandise_stores-price_purchaser',
  clothing_stores:    'general_retail-type_clothing_and_clothing_accessories_stores-price_purchaser',
  gas_stations:       'general_retail-type_gasoline_stations-price_purchaser',
  electronics:        'electronics-type_other_electronic_component-price_purchaser',
  book_publishers:    'paper_products-type_book_publishers-price_purchaser',
  spectator_sports:   'consumer_goods-type_spectator_sports-price_purchaser',
  amusement_parks:    'consumer_goods-type_amusement_parks_arcades-price_purchaser',
  amusement_other:    'consumer_goods-type_other_amusement_and_recreation_industries-price_purchaser',
  personal_care:      'consumer_goods-type_personal_care_services-price_purchaser',
  health_personal:    'general_retail-type_health_and_personal_care_stores-price_purchaser',
  hospitals:          'health_care-type_hospitals-price_purchaser',
  accommodation:      'accommodation-type_accommodation-price_purchaser',
  car_rental:         'equipment_rental-type_automotive_equipment_rental_and_leasing-price_purchaser',
  air_transport:      'freight_flight-route_type_air_transportation-distance_na-weight_na-rf_na-method_na-aircraft_type_na-distance_uplift_na-price_purchaser',
  ground_transit:     'passenger_vehicle-vehicle_type_transit_and_ground_passenger_transportation_state_and_local_government_passenger_transit-fuel_source_na-engine_size_na-vehicle_age_na-vehicle_weight_na-price_purchaser',
  electricity:        'electricity-supply_electric_power_generation_transmission_and_distribution-source_na-price_purchaser',
  natural_gas:        'fuel-type_natural_gas_distribution-fuel_use_na-price_purchaser',
  water:              'water_treatment-type_water_sewage_and_other_systems-price_purchaser',
  cable_subscription: 'communication_services-type_cable_and_other_subscription_programming-price_purchaser',
  internet:           'communication_services-type_internet_publishing_and_broadcasting_and_web_search_portals-price_purchaser',
} as const;

/** Fallback table keyed by `personal_finance_category.primary`. */
const PRIMARY_FACTORS: Record<string, CategoryMapping> = {
  // Real spend — counts toward footprint
  FOOD_AND_DRINK:           { dbCategory: 'food',          kgPerUsd: 0.16,  activityId: CEDA.restaurant_full },
  GENERAL_MERCHANDISE:      { dbCategory: 'other',         kgPerUsd: 0.32,  activityId: CEDA.gen_merchandise },
  HOME_IMPROVEMENT:         { dbCategory: 'housing',       kgPerUsd: 0.32,  activityId: CEDA.gen_merchandise },
  PERSONAL_CARE:            { dbCategory: 'services',      kgPerUsd: 0.20,  activityId: CEDA.personal_care },
  GENERAL_SERVICES:         { dbCategory: 'services',      kgPerUsd: 0.20,  activityId: CEDA.personal_care },
  MEDICAL:                  { dbCategory: 'services',      kgPerUsd: 0.18,  activityId: CEDA.hospitals },
  ENTERTAINMENT:            { dbCategory: 'entertainment', kgPerUsd: 0.16,  activityId: CEDA.amusement_other },
  TRANSPORTATION:           { dbCategory: 'transport',     kgPerUsd: 0.30,  activityId: CEDA.gas_stations },
  TRAVEL:                   { dbCategory: 'transport',     kgPerUsd: 0.45,  activityId: CEDA.accommodation },
  RENT_AND_UTILITIES:       { dbCategory: 'utilities',     kgPerUsd: 0.55,  activityId: CEDA.electricity },
  GOVERNMENT_AND_NON_PROFIT:{ dbCategory: 'services',      kgPerUsd: 0.20,  activityId: CEDA.personal_care },

  // Non-consumption — passes through with 0 carbon
  INCOME:                   { dbCategory: 'other',         kgPerUsd: 0.0,   activityId: 'circular:no-impact' },
  TRANSFER_IN:              { dbCategory: 'other',         kgPerUsd: 0.0,   activityId: 'circular:no-impact' },
  TRANSFER_OUT:             { dbCategory: 'other',         kgPerUsd: 0.0,   activityId: 'circular:no-impact' },
  LOAN_PAYMENTS:            { dbCategory: 'other',         kgPerUsd: 0.0,   activityId: 'circular:no-impact' },
  BANK_FEES:                { dbCategory: 'other',         kgPerUsd: 0.0,   activityId: 'circular:no-impact' },
};

/** Overrides keyed by `personal_finance_category.detailed`. Anything
 *  not listed here falls through to PRIMARY_FACTORS. */
const DETAILED_OVERRIDES: Record<string, CategoryMapping> = {
  // ── Food: groceries vs restaurants vs coffee vs alcohol ──
  FOOD_AND_DRINK_GROCERIES:            { dbCategory: 'food', kgPerUsd: 0.20, activityId: CEDA.food_bev_stores },
  FOOD_AND_DRINK_RESTAURANT:           { dbCategory: 'food', kgPerUsd: 0.16, activityId: CEDA.restaurant_full },
  FOOD_AND_DRINK_FAST_FOOD:            { dbCategory: 'food', kgPerUsd: 0.15, activityId: CEDA.restaurant_limited },
  FOOD_AND_DRINK_COFFEE:               { dbCategory: 'food', kgPerUsd: 0.15, activityId: CEDA.restaurant_limited },
  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: { dbCategory: 'food', kgPerUsd: 0.20, activityId: CEDA.food_bev_stores },

  // ── Travel: split flights from ground / lodging ──
  TRAVEL_FLIGHTS:                  { dbCategory: 'transport', kgPerUsd: 0.55, activityId: CEDA.air_transport },
  TRAVEL_RENTAL_CARS:              { dbCategory: 'transport', kgPerUsd: 0.18, activityId: CEDA.car_rental },
  TRAVEL_LODGING:                  { dbCategory: 'services',  kgPerUsd: 0.45, activityId: CEDA.accommodation },
  TRAVEL_OTHER_TRAVEL:             { dbCategory: 'transport', kgPerUsd: 0.40, activityId: CEDA.air_transport },

  // ── Transportation: gas heavier, transit lighter, micromobility tiny ──
  TRANSPORTATION_GAS:                  { dbCategory: 'transport', kgPerUsd: 0.30, activityId: CEDA.gas_stations },
  TRANSPORTATION_PUBLIC_TRANSIT:       { dbCategory: 'transport', kgPerUsd: 0.10, activityId: CEDA.ground_transit },
  TRANSPORTATION_BIKES_AND_SCOOTERS:   { dbCategory: 'transport', kgPerUsd: 0.02, activityId: 'circular:micromobility' },
  TRANSPORTATION_TAXIS_AND_RIDE_SHARES:{ dbCategory: 'transport', kgPerUsd: 0.30, activityId: CEDA.ground_transit },
  TRANSPORTATION_PARKING:              { dbCategory: 'transport', kgPerUsd: 0.05, activityId: CEDA.personal_care },
  TRANSPORTATION_TOLLS:                { dbCategory: 'transport', kgPerUsd: 0.05, activityId: CEDA.personal_care },

  // ── General merchandise: pull electronics + clothing into proper buckets ──
  GENERAL_MERCHANDISE_ELECTRONICS:              { dbCategory: 'electronics', kgPerUsd: 0.30, activityId: CEDA.electronics },
  GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES: { dbCategory: 'clothing',    kgPerUsd: 0.25, activityId: CEDA.clothing_stores },
  GENERAL_MERCHANDISE_SPORTING_GOODS:           { dbCategory: 'other',       kgPerUsd: 0.32, activityId: CEDA.gen_merchandise },
  GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS:{ dbCategory: 'other',       kgPerUsd: 0.18, activityId: CEDA.book_publishers },
  GENERAL_MERCHANDISE_PET_SUPPLIES:             { dbCategory: 'other',       kgPerUsd: 0.32, activityId: CEDA.gen_merchandise },
  GENERAL_MERCHANDISE_OFFICE_SUPPLIES:          { dbCategory: 'other',       kgPerUsd: 0.32, activityId: CEDA.gen_merchandise },

  // ── Rent / utilities split for clarity ──
  RENT_AND_UTILITIES_GAS_AND_ELECTRICITY:{ dbCategory: 'utilities', kgPerUsd: 0.55, activityId: CEDA.electricity },
  RENT_AND_UTILITIES_WATER:              { dbCategory: 'utilities', kgPerUsd: 0.18, activityId: CEDA.water },
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: { dbCategory: 'utilities', kgPerUsd: 0.12, activityId: CEDA.cable_subscription },
  RENT_AND_UTILITIES_RENT:               { dbCategory: 'housing',   kgPerUsd: 0.0,  activityId: 'circular:no-impact' }, // rent itself is a transfer, no consumption carbon

  // ── Entertainment sub-types ──
  ENTERTAINMENT_TV_AND_MOVIES:     { dbCategory: 'entertainment', kgPerUsd: 0.12, activityId: CEDA.cable_subscription },
  ENTERTAINMENT_VIDEO_GAMES:       { dbCategory: 'entertainment', kgPerUsd: 0.18, activityId: CEDA.amusement_other },
  ENTERTAINMENT_MUSIC_AND_AUDIO:   { dbCategory: 'entertainment', kgPerUsd: 0.12, activityId: CEDA.amusement_other },
  ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS:
                                   { dbCategory: 'entertainment', kgPerUsd: 0.18, activityId: CEDA.amusement_parks },

  // ── Personal care + medical sub-types ──
  PERSONAL_CARE_HAIR_AND_BEAUTY:   { dbCategory: 'services', kgPerUsd: 0.20, activityId: CEDA.personal_care },
  PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING:
                                   { dbCategory: 'services', kgPerUsd: 0.20, activityId: CEDA.personal_care },
  MEDICAL_PHARMACIES_AND_SUPPLEMENTS:
                                   { dbCategory: 'services', kgPerUsd: 0.20, activityId: CEDA.health_personal },
  MEDICAL_PRIMARY_CARE:            { dbCategory: 'services', kgPerUsd: 0.18, activityId: CEDA.hospitals },
};

const DEFAULT_MAPPING: CategoryMapping = {
  dbCategory: 'other',
  kgPerUsd: 0.30,
  activityId: CEDA.gen_merchandise,
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
