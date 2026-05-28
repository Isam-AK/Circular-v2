// ============================================================
// spend-carbon.ts
//
// Plaid `personal_finance_category.primary` → kg CO₂e per USD spend.
//
// Values are USA-region spend-based emission factors sourced from
// Climatiq's EXIOBASE-derived datasets, rounded to 3 sig figs. Each
// entry includes the Climatiq `activity_id` we'd hit if/when we swap
// the hardcoded factor for a live API estimate (Phase 3).
//
// "Skip" categories are ones that don't represent consumption (income,
// transfers, fees, loans). These transactions are still surfaced to the
// user but their carbon_kg is 0 — they don't count toward the
// footprint.
// ============================================================

export interface CategoryFactor {
  /** kg CO₂e per 1 USD of spend. Zero means "no carbon impact" (transfers, etc). */
  kgPerUsd: number;
  /** Climatiq activity_id that would be used for a live estimate. */
  activityId: string;
}

export const CATEGORY_FACTORS: Record<string, CategoryFactor> = {
  // Real spend — counts toward footprint
  FOOD_AND_DRINK:           { kgPerUsd: 0.42,  activityId: 'consumer_goods-type_food_beverages_tobacco' },
  GENERAL_MERCHANDISE:      { kgPerUsd: 0.36,  activityId: 'consumer_goods-type_other_manufactured_goods' },
  HOME_IMPROVEMENT:         { kgPerUsd: 0.48,  activityId: 'construction-type_residential_buildings' },
  PERSONAL_CARE:            { kgPerUsd: 0.22,  activityId: 'services-type_other_services' },
  GENERAL_SERVICES:         { kgPerUsd: 0.22,  activityId: 'services-type_other_services' },
  MEDICAL:                  { kgPerUsd: 0.18,  activityId: 'services-type_health_social_work' },
  ENTERTAINMENT:            { kgPerUsd: 0.16,  activityId: 'services-type_recreational_cultural_sporting' },
  TRANSPORTATION:           { kgPerUsd: 0.32,  activityId: 'transport_services-type_passenger_road_transport' },
  TRAVEL:                   { kgPerUsd: 0.55,  activityId: 'transport_services-type_passenger_air_transport' },
  RENT_AND_UTILITIES:       { kgPerUsd: 0.62,  activityId: 'electricity-supply_grid-source_residual_mix' },
  GOVERNMENT_AND_NON_PROFIT:{ kgPerUsd: 0.20,  activityId: 'services-type_public_administration_defense' },

  // Non-consumption — passes through with 0 carbon
  INCOME:                   { kgPerUsd: 0.0,   activityId: 'circular:no-impact' },
  TRANSFER_IN:              { kgPerUsd: 0.0,   activityId: 'circular:no-impact' },
  TRANSFER_OUT:             { kgPerUsd: 0.0,   activityId: 'circular:no-impact' },
  LOAN_PAYMENTS:            { kgPerUsd: 0.0,   activityId: 'circular:no-impact' },
  BANK_FEES:                { kgPerUsd: 0.0,   activityId: 'circular:no-impact' },
};

/** Maps a Plaid primary category to our DB enum + carbon factor. Falls back to "other". */
export function classify(
  plaidPrimaryCategory: string | null | undefined,
): {
  dbCategory: string;
  factor: CategoryFactor;
} {
  const key = (plaidPrimaryCategory ?? '').toUpperCase();
  const factor = CATEGORY_FACTORS[key] ?? { kgPerUsd: 0.30, activityId: 'consumer_goods-type_other_manufactured_goods' };

  // Map to the public.transactions.transaction_category enum.
  // The DB enum is narrower than Plaid's taxonomy, so we collapse some
  // categories into the closest enum value.
  const dbCategory = (() => {
    switch (key) {
      case 'FOOD_AND_DRINK':            return 'food';
      case 'TRANSPORTATION':            return 'transport';
      case 'TRAVEL':                    return 'transport';
      case 'RENT_AND_UTILITIES':        return 'utilities';
      case 'HOME_IMPROVEMENT':          return 'housing';
      case 'GENERAL_MERCHANDISE':       return 'clothing'; // closest catch-all retail
      case 'ENTERTAINMENT':             return 'entertainment';
      case 'PERSONAL_CARE':             return 'services';
      case 'GENERAL_SERVICES':          return 'services';
      case 'MEDICAL':                   return 'services';
      case 'GOVERNMENT_AND_NON_PROFIT': return 'services';
      default:                          return 'other';
    }
  })();

  return { dbCategory, factor };
}
