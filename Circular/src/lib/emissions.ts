import type { TransportMode } from '@/types/database';

/**
 * Emission factors per transport mode in **kg CO₂e per km**, per passenger.
 *
 * Sourced from UK DEFRA 2024 Greenhouse Gas Conversion Factors, rounded to
 * 3 significant figures. These are first-order client-side estimates; for
 * production-grade accounting, swap each call site to the Climatiq API and
 * persist the activity_id returned. The current values err slightly on the
 * conservative (higher-carbon) side to avoid under-counting.
 *
 *   walk       → 0.000  (no operational emissions; embodied food calories ignored)
 *   bike       → 0.000  (same caveat; e-bikes would differ)
 *   bus        → 0.105  (average UK local bus, ~10 passengers)
 *   train      → 0.041  (national rail, mixed diesel/electric)
 *   car        → 0.171  (average petrol car, solo driver)
 *   ev_car     → 0.050  (battery EV on average grid mix; varies by country)
 *   hybrid_car → 0.103  (mid-size plug-in hybrid, mixed real-world usage)
 *   rideshare  → 0.131  (assumes ~1.3 occupancy improvement over solo car)
 *   flight     → 0.255  (average short-haul economy, includes radiative forcing)
 */
export const EMISSION_FACTORS_KG_PER_KM: Record<TransportMode, number> = {
  walk: 0.0,
  bike: 0.0,
  bus: 0.105,
  train: 0.041,
  car: 0.171,
  ev_car: 0.05,
  hybrid_car: 0.103,
  rideshare: 0.131,
  flight: 0.255,
};

/** Compute carbon emissions for a trip in kg CO₂e. Rounded to 4 decimals to match DB scale. */
export function carbonForTrip(mode: TransportMode, distanceKm: number): number {
  const factor = EMISSION_FACTORS_KG_PER_KM[mode];
  return Math.round(factor * distanceKm * 10_000) / 10_000;
}

/**
 * The baseline we count savings against: a solo trip in an average petrol car.
 * Choosing anything cleaner counts toward `users.carbon_saved`. Choosing
 * something worse (flight) saves nothing — the extra emission is already
 * reflected in `carbon_score`.
 */
export const BASELINE_FACTOR_KG_PER_KM = EMISSION_FACTORS_KG_PER_KM.car;

/** Compute carbon savings for a trip in kg CO₂e (vs. baseline petrol car). Never negative. */
export function savingsForTrip(mode: TransportMode, distanceKm: number): number {
  const diff = (BASELINE_FACTOR_KG_PER_KM - EMISSION_FACTORS_KG_PER_KM[mode]) * distanceKm;
  return Math.max(0, Math.round(diff * 10_000) / 10_000);
}

/** Whether a mode counts as "green" (no operational carbon). Used for UI hinting. */
export function isGreenMode(mode: TransportMode): boolean {
  return EMISSION_FACTORS_KG_PER_KM[mode] === 0;
}

/** Human-readable tier label for total lifetime savings (kg CO₂e). */
export function savingsTierLabel(savedKg: number): string {
  if (savedKg >= 200) return 'Climate champion';
  if (savedKg >= 50) return 'Great progress';
  if (savedKg >= 10) return 'Building momentum';
  if (savedKg >= 1) return 'Getting started';
  return 'Log your first green trip';
}

/** Display-friendly metadata for each mode. */
export const MODE_META: Record<TransportMode, { label: string; icon: string }> = {
  walk: { label: 'Walk', icon: '🚶' },
  bike: { label: 'Bike', icon: '🚲' },
  bus: { label: 'Bus', icon: '🚌' },
  train: { label: 'Train', icon: '🚆' },
  car: { label: 'Car', icon: '🚗' },
  ev_car: { label: 'EV', icon: '🔌' },
  hybrid_car: { label: 'Hybrid', icon: '🌿' },
  rideshare: { label: 'Rideshare', icon: '🚕' },
  flight: { label: 'Flight', icon: '✈️' },
};

export const ALL_MODES: TransportMode[] = [
  'walk',
  'bike',
  'bus',
  'train',
  'car',
  'ev_car',
  'hybrid_car',
  'rideshare',
  'flight',
];
