// Hand-maintained contract for supabase/migrations/20261008000100_create_notes.sql.
// Generate from the deployed database once remote migration access is available.
export type NoteRow = {
  user_id: string;
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  is_pinned: boolean;
  schema_version: number;
};

export type Database = {
  public: {
    Tables: {
      notes: {
        Row: NoteRow;
        Insert: Pick<NoteRow, "user_id" | "id"> & Partial<Omit<NoteRow, "user_id" | "id">>;
        Update: Partial<Pick<NoteRow,
          "title" | "content" | "updated_at" | "deleted_at" | "is_pinned" | "schema_version"
        >>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
