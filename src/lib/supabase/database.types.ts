export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      house: {
        Row: {
          id: string;
          name: string;
          invite_code: string;
          owner_id: string;
          timezone: string;
          is_paused: boolean;
          travel_mode_started_at: string | null;
          travel_offset_days: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          invite_code?: string;
          owner_id: string;
          timezone?: string;
          is_paused?: boolean;
          travel_mode_started_at?: string | null;
          travel_offset_days?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          invite_code?: string;
          owner_id?: string;
          timezone?: string;
          is_paused?: boolean;
          travel_mode_started_at?: string | null;
          travel_offset_days?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_house_bridge: {
        Row: {
          user_id: string;
          house_id: string;
          role: Database["public"]["Enums"]["membership_role"];
          display_name: string | null;
          avatar_url: string | null;
          notifications_enabled: boolean;
          total_points: number;
          current_streak_days: number;
          last_opened_on: string | null;
          last_seen_travel_offset_days: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          house_id: string;
          role?: Database["public"]["Enums"]["membership_role"];
          display_name?: string | null;
          avatar_url?: string | null;
          notifications_enabled?: boolean;
          total_points?: number;
          current_streak_days?: number;
          last_opened_on?: string | null;
          last_seen_travel_offset_days?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          house_id?: string;
          role?: Database["public"]["Enums"]["membership_role"];
          display_name?: string | null;
          avatar_url?: string | null;
          notifications_enabled?: boolean;
          total_points?: number;
          current_streak_days?: number;
          last_opened_on?: string | null;
          last_seen_travel_offset_days?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      room: {
        Row: {
          id: string;
          house_id: string;
          name: string;
          type: Database["public"]["Enums"]["room_type"];
          icon_ref: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          house_id: string;
          name: string;
          type?: Database["public"]["Enums"]["room_type"];
          icon_ref?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          house_id?: string;
          name?: string;
          type?: Database["public"]["Enums"]["room_type"];
          icon_ref?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      task: {
        Row: {
          id: string;
          room_id: string;
          house_id: string;
          assigned_to: string | null;
          assigned_user_ids: string[];
          assignment_mode: string;
          name: string;
          frequency_days: number;
          effort_points: number;
          last_completed_at: string | null;
          next_due_date: string | null;
          status: Database["public"]["Enums"]["task_status"];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          house_id: string;
          assigned_to?: string | null;
          assigned_user_ids?: string[];
          assignment_mode?: string;
          name: string;
          frequency_days: number;
          effort_points?: number;
          last_completed_at?: string | null;
          next_due_date?: string | null;
          status?: Database["public"]["Enums"]["task_status"];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          house_id?: string;
          assigned_to?: string | null;
          assigned_user_ids?: string[];
          assignment_mode?: string;
          name?: string;
          frequency_days?: number;
          effort_points?: number;
          last_completed_at?: string | null;
          next_due_date?: string | null;
          status?: Database["public"]["Enums"]["task_status"];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      task_history: {
        Row: {
          id: string;
          task_id: string;
          user_id: string;
          completed_at: string;
          previous_due_date: string | null;
          points_awarded: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          user_id: string;
          completed_at?: string;
          previous_due_date?: string | null;
          points_awarded: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          task_id?: string;
          user_id?: string;
          completed_at?: string;
          previous_due_date?: string | null;
          points_awarded?: number;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      apply_travel_mode_offset: {
        Args: { p_house_id: string };
        Returns: number;
      };
      can_manage_house: {
        Args: { p_house_id: string };
        Returns: boolean;
      };
      join_house_by_invite_code: {
        Args: { p_invite_code: string };
        Returns: string;
      };
      get_leaderboard_points: {
        Args: {
          p_scope: string;
          p_range: string;
          p_house_id?: string | null;
        };
        Returns: {
          user_id: string;
          points: number;
        }[];
      };
    };
    Enums: {
      membership_role: "owner" | "member" | "helper";
      room_type:
        | "kitchen"
        | "bathroom"
        | "bedroom"
        | "living_room"
        | "dining_room"
        | "laundry"
        | "garage"
        | "outdoor"
        | "office"
        | "other";
      task_status: "active" | "paused";
    };
    CompositeTypes: Record<string, never>;
  };
};
