/**
 * Recycling savings model.
 *
 * Each catalog entry carries two snapshot-able savings figures:
 *   • co2SavedKgPerItem — kg CO₂e avoided by recycling one item instead of
 *     sending it to landfill/incineration. First-order per-item estimates
 *     derived from typical LCA / US EPA WARM material savings combined with
 *     average item weights. Conservative and clearly approximate — swap for
 *     a proper LCA source later if needed.
 *   • depositEur — German single-use deposit (Pfand) refunded per item.
 *     0.25 € for single-use PET bottles & metal cans; lower for reusable
 *     (Mehrweg) glass; 0 for items with no deposit scheme.
 *
 * Mirrors the shape/intent of src/lib/emissions.ts. Values here MUST match
 * any backfill in supabase/migrations if one is ever added.
 */

import type { RecyclingSource } from '@/types/database';

export interface RecyclableMaterial {
  /** Stable key persisted to recycling_logs.material_key. */
  key: string;
  label: string;
  icon: string;
  /** kg CO₂e avoided per item recycled. */
  co2SavedKgPerItem: number;
  /** German Pfand deposit refunded per item, in EUR (0 if none). */
  depositEur: number;
}

export const RECYCLABLES: RecyclableMaterial[] = [
  {
    key: 'pet_bottle_500',
    label: '500 ml plastic bottle',
    icon: '🥤',
    co2SavedKgPerItem: 0.04,
    depositEur: 0.25,
  },
  {
    key: 'pet_bottle_1500',
    label: '1.5 L plastic bottle',
    icon: '🍶',
    co2SavedKgPerItem: 0.06,
    depositEur: 0.25,
  },
  {
    key: 'alu_can_330',
    label: 'Drink can (330 ml)',
    icon: '🥫',
    co2SavedKgPerItem: 0.14,
    depositEur: 0.25,
  },
  {
    key: 'glass_bottle',
    label: 'Glass bottle (reusable)',
    icon: '🍾',
    co2SavedKgPerItem: 0.15,
    depositEur: 0.08,
  },
  {
    key: 'glass_jar',
    label: 'Glass jar',
    icon: '🫙',
    co2SavedKgPerItem: 0.1,
    depositEur: 0,
  },
  {
    key: 'carton_1l',
    label: 'Drink carton (1 L)',
    icon: '🧃',
    co2SavedKgPerItem: 0.07,
    depositEur: 0,
  },
  {
    key: 'cardboard_box',
    label: 'Cardboard box',
    icon: '📦',
    co2SavedKgPerItem: 0.45,
    depositEur: 0,
  },
];

/** Lookup a material by its catalog key. */
export function findMaterial(key: string): RecyclableMaterial | undefined {
  return RECYCLABLES.find((m) => m.key === key);
}

/** kg CO₂e saved for `quantity` of a material, rounded to DB scale (4dp). */
export function co2SavedFor(material: RecyclableMaterial, quantity: number): number {
  return Math.round(material.co2SavedKgPerItem * quantity * 10_000) / 10_000;
}

/** EUR deposit refunded for `quantity` of a material, rounded to cents. */
export function moneySavedFor(material: RecyclableMaterial, quantity: number): number {
  return Math.round(material.depositEur * quantity * 100) / 100;
}

/** Compact "€7.50 · 1.2 kg CO₂e" style summary for a quantity of a material. */
export function savingsSummary(material: RecyclableMaterial, quantity: number): string {
  const eur = moneySavedFor(material, quantity);
  const co2 = co2SavedFor(material, quantity);
  return `€${eur.toFixed(2)} · ${co2.toFixed(2)} kg CO₂e`;
}

// ── Barcode lookup (Open Food Facts) ───────────────────────
//
// Best-effort: map a scanned EAN/UPC to a product name + a guessed catalog
// material from Open Food Facts packaging tags. Free, keyless API. Falls back
// to "no guess" so the user can pick manually. Beverage coverage is decent;
// anything unknown just returns the name (or nothing).

export interface BarcodeLookupResult {
  /** Product display name, if found. */
  productName?: string;
  /** Best-guess catalog key, if packaging maps cleanly. */
  materialKey?: string;
}

/** Map Open Food Facts packaging tag tokens to a catalog key. */
function guessMaterialFromPackaging(tags: string[]): string | undefined {
  const joined = tags.join(' ').toLowerCase();
  const has = (s: string) => joined.includes(s);

  if (has('can')) return 'alu_can_330';
  if (has('carton') || has('tetra') || has('brick')) return 'carton_1l';
  if (has('glass') && has('jar')) return 'glass_jar';
  if (has('glass')) return 'glass_bottle';
  if (has('cardboard') || has('corrugated')) return 'cardboard_box';
  if ((has('plastic') || has('pet')) && has('bottle')) return 'pet_bottle_500';
  return undefined;
}

/**
 * Look up a barcode via Open Food Facts. Returns {} on any miss/error so the
 * caller can quietly fall back to manual entry. Never throws.
 */
export async function lookupBarcode(barcode: string): Promise<BarcodeLookupResult> {
  try {
    const url =
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json` +
      `?fields=product_name,packaging_tags,packaging`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Circular/1.0 (sustainability app)' },
    });
    if (!res.ok) return {};
    const json: any = await res.json();
    if (json?.status !== 1 || !json.product) return {};

    const product = json.product;
    const tags: string[] = Array.isArray(product.packaging_tags)
      ? product.packaging_tags
      : typeof product.packaging === 'string'
        ? product.packaging.split(',')
        : [];

    return {
      productName: product.product_name || undefined,
      materialKey: guessMaterialFromPackaging(tags),
    };
  } catch {
    return {};
  }
}

// Re-export for screens that build entries without importing the type module.
export type { RecyclingSource };
