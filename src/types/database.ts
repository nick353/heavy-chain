export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          name: string | null
          avatar_url: string | null
          language: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          name?: string | null
          avatar_url?: string | null
          language?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string | null
          avatar_url?: string | null
          language?: string
          created_at?: string
          updated_at?: string
        }
      }
      brands: {
        Row: {
          id: string
          owner_id: string
          name: string
          logo_url: string | null
          brand_colors: Json | null
          tone_description: string | null
          target_audience: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          name: string
          logo_url?: string | null
          brand_colors?: Json | null
          tone_description?: string | null
          target_audience?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          name?: string
          logo_url?: string | null
          brand_colors?: Json | null
          tone_description?: string | null
          target_audience?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      brand_members: {
        Row: {
          id: string
          brand_id: string
          user_id: string
          role: 'owner' | 'admin' | 'editor' | 'viewer'
          invited_at: string
          joined_at: string | null
        }
        Insert: {
          id?: string
          brand_id: string
          user_id: string
          role: 'owner' | 'admin' | 'editor' | 'viewer'
          invited_at?: string
          joined_at?: string | null
        }
        Update: {
          id?: string
          brand_id?: string
          user_id?: string
          role?: 'owner' | 'admin' | 'editor' | 'viewer'
          invited_at?: string
          joined_at?: string | null
        }
      }
      generation_jobs: {
        Row: {
          id: string
          brand_id: string
          user_id: string
          feature_type: string
          input_params: Json
          optimized_prompt: string | null
          status: 'pending' | 'processing' | 'completed' | 'failed'
          error_message: string | null
          created_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          brand_id: string
          user_id: string
          feature_type: string
          input_params: Json
          optimized_prompt?: string | null
          status?: 'pending' | 'processing' | 'completed' | 'failed'
          error_message?: string | null
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          brand_id?: string
          user_id?: string
          feature_type?: string
          input_params?: Json
          optimized_prompt?: string | null
          status?: 'pending' | 'processing' | 'completed' | 'failed'
          error_message?: string | null
          created_at?: string
          completed_at?: string | null
        }
      }
      generated_images: {
        Row: {
          id: string
          job_id: string | null
          brand_id: string
          user_id: string
          storage_path: string
          image_url: string | null
          thumbnail_path: string | null
          version: number
          parent_image_id: string | null
          is_favorite: boolean
          created_at: string
          expires_at: string | null
          // Metadata fields
          prompt: string | null
          negative_prompt: string | null
          feature_type: string | null
          style_preset: string | null
          model_used: string | null
          generation_params: Json | null
          metadata: Json | null
        }
        Insert: {
          id?: string
          job_id?: string | null
          brand_id: string
          user_id: string
          storage_path: string
          image_url?: string | null
          thumbnail_path?: string | null
          version?: number
          parent_image_id?: string | null
          is_favorite?: boolean
          created_at?: string
          expires_at?: string | null
          prompt?: string | null
          negative_prompt?: string | null
          feature_type?: string | null
          style_preset?: string | null
          model_used?: string | null
          generation_params?: Json | null
          metadata?: Json | null
        }
        Update: {
          id?: string
          job_id?: string | null
          brand_id?: string
          user_id?: string
          storage_path?: string
          image_url?: string | null
          thumbnail_path?: string | null
          version?: number
          parent_image_id?: string | null
          is_favorite?: boolean
          created_at?: string
          expires_at?: string | null
          prompt?: string | null
          negative_prompt?: string | null
          feature_type?: string | null
          style_preset?: string | null
          model_used?: string | null
          generation_params?: Json | null
          metadata?: Json | null
        }
      }
      folders: {
        Row: {
          id: string
          brand_id: string
          parent_folder_id: string | null
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          brand_id: string
          parent_folder_id?: string | null
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          brand_id?: string
          parent_folder_id?: string | null
          name?: string
          created_at?: string
        }
      }
      tags: {
        Row: {
          id: string
          brand_id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          brand_id: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          brand_id?: string
          name?: string
          created_at?: string
        }
      }
      image_tags: {
        Row: {
          image_id: string
          tag_id: string
        }
        Insert: {
          image_id: string
          tag_id: string
        }
        Update: {
          image_id?: string
          tag_id?: string
        }
      }
      image_folders: {
        Row: {
          image_id: string
          folder_id: string
        }
        Insert: {
          image_id: string
          folder_id: string
        }
        Update: {
          image_id?: string
          folder_id?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}

// Convenience types
export type User = Database['public']['Tables']['users']['Row']
export type Brand = Database['public']['Tables']['brands']['Row']
export type BrandMember = Database['public']['Tables']['brand_members']['Row']
export type GenerationJob = Database['public']['Tables']['generation_jobs']['Row']
export type GeneratedImage = Database['public']['Tables']['generated_images']['Row']
export type Folder = Database['public']['Tables']['folders']['Row']
export type Tag = Database['public']['Tables']['tags']['Row']

// Extended types with metadata
export interface ImageMetadata {
  prompt?: string
  negativePrompt?: string
  featureType?: string
  stylePreset?: string
  aspectRatio?: string
  width?: number
  height?: number
  referenceImageId?: string
  tags?: string[]
  colors?: string[]
  generationParams?: Record<string, unknown>
}

export interface GeneratedImageWithMeta extends GeneratedImage {
  tags?: Tag[]
  folders?: Folder[]
  parsedMetadata?: ImageMetadata
}






