// ============================================================
// Circular — Supabase Database Type Definitions
// Mirrors schema.sql exactly for end-to-end type safety.
// ============================================================

export type TransportMode =
  | 'walk'
  | 'bike'
  | 'bus'
  | 'train'
  | 'car'
  | 'rideshare'
  | 'flight';

export type ItemCondition = 'new' | 'like_new' | 'good' | 'fair' | 'needs_repair';

export type ItemStatus = 'available' | 'reserved' | 'shared' | 'withdrawn';

export type TransactionCategory =
  | 'food'
  | 'transport'
  | 'housing'
  | 'clothing'
  | 'electronics'
  | 'services'
  | 'entertainment'
  | 'utilities'
  | 'other';

export interface User {
  id: string;
  display_name: string;
  avatar_url: string | null;
  carbon_score: number;
  carbon_saved: number;
  streak_days: number;
  level: number;
  xp: number;
  plaid_access_token: string | null;
  plaid_item_id: string | null;
  last_location: GeoPoint | null;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  plaid_transaction_id: string | null;
  merchant_name: string | null;
  amount: number;
  currency: string;
  transaction_date: string;
  category: TransactionCategory;
  carbon_kg: number;
  climatiq_activity_id: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
}

export interface MobilityLog {
  id: string;
  user_id: string;
  mode: TransportMode;
  distance_km: number;
  duration_min: number | null;
  carbon_kg: number;
  route: GeoLineString | null;
  start_point: GeoPoint | null;
  end_point: GeoPoint | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

export interface SharedItem {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  image_urls: string[];
  condition: ItemCondition;
  status: ItemStatus;
  location: GeoPoint;
  carbon_saved_kg: number;
  tags: string[];
  created_at: string;
  updated_at: string;
}

// PostGIS geography types as returned by Supabase
export interface GeoPoint {
  type: 'Point';
  coordinates: [longitude: number, latitude: number];
}

export interface GeoLineString {
  type: 'LineString';
  coordinates: [longitude: number, latitude: number][];
}

// Supabase Database type map (for supabase-js generics)
export interface Database {
  public: {
    Tables: {
      users: {
        Row: User;
        Insert: Omit<User, 'created_at' | 'updated_at' | 'carbon_score' | 'carbon_saved' | 'streak_days' | 'level' | 'xp'> & Partial<Pick<User, 'carbon_score' | 'carbon_saved' | 'streak_days' | 'level' | 'xp'>>;
        Update: Partial<Omit<User, 'id' | 'created_at'>>;
      };
      transactions: {
        Row: Transaction;
        Insert: Omit<Transaction, 'id' | 'created_at'>;
        Update: Partial<Omit<Transaction, 'id' | 'user_id' | 'created_at'>>;
      };
      mobility_logs: {
        Row: MobilityLog;
        Insert: Omit<MobilityLog, 'id' | 'created_at'>;
        Update: Partial<Omit<MobilityLog, 'id' | 'user_id' | 'created_at'>>;
      };
      shared_items: {
        Row: SharedItem;
        Insert: Omit<SharedItem, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<SharedItem, 'id' | 'owner_id' | 'created_at'>>;
      };
    };
    Functions: {
      nearby_items: {
        Args: { lat: number; lng: number; radius_m?: number };
        Returns: SharedItem[];
      };
      recalculate_carbon_score: {
        Args: { target_user_id: string };
        Returns: number;
      };
    };
  };
}
