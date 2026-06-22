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
          is_admin: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          name?: string | null
          avatar_url?: string | null
          language?: string
          is_admin?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string | null
          avatar_url?: string | null
          language?: string
          is_admin?: boolean
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
      lightchain_task_steps: {
        Row: {
          id: string
          job_id: string
          image_id: string | null
          brand_id: string
          user_id: string
          lightchain_feature_id: string
          lightchain_feature_title: string
          task_code: string
          step_index: number
          status: 'queued' | 'processing' | 'completed' | 'failed' | 'retryable'
          source_workspace: string | null
          workflow_version: string | null
          request_id: string | null
          artifact_uri: string | null
          error_message: string | null
          metadata: Json
          created_at: string
          updated_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          job_id: string
          image_id?: string | null
          brand_id: string
          user_id: string
          lightchain_feature_id: string
          lightchain_feature_title: string
          task_code: string
          step_index?: number
          status?: 'queued' | 'processing' | 'completed' | 'failed' | 'retryable'
          source_workspace?: string | null
          workflow_version?: string | null
          request_id?: string | null
          artifact_uri?: string | null
          error_message?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          job_id?: string
          image_id?: string | null
          brand_id?: string
          user_id?: string
          lightchain_feature_id?: string
          lightchain_feature_title?: string
          task_code?: string
          step_index?: number
          status?: 'queued' | 'processing' | 'completed' | 'failed' | 'retryable'
          source_workspace?: string | null
          workflow_version?: string | null
          request_id?: string | null
          artifact_uri?: string | null
          error_message?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
          completed_at?: string | null
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
      style_presets: {
        Row: {
          id: string
          brand_id: string
          name: string
          prompt_template: string | null
          settings: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          brand_id: string
          name: string
          prompt_template?: string | null
          settings?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          brand_id?: string
          name?: string
          prompt_template?: string | null
          settings?: Json | null
          created_at?: string
        }
      }
      api_usage_logs: {
        Row: {
          id: string
          user_id: string
          brand_id: string | null
          provider: 'openai' | 'gemini'
          tokens_used: number | null
          cost_usd: number | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          brand_id?: string | null
          provider: 'openai' | 'gemini'
          tokens_used?: number | null
          cost_usd?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          brand_id?: string | null
          provider?: 'openai' | 'gemini'
          tokens_used?: number | null
          cost_usd?: number | null
          created_at?: string
        }
      }
      share_links: {
        Row: {
          id: string
          image_id: string
          token: string
          created_by: string
          expires_at: string
          created_at: string
        }
        Insert: {
          id?: string
          image_id: string
          token: string
          created_by: string
          expires_at: string
          created_at?: string
        }
        Update: {
          id?: string
          image_id?: string
          token?: string
          created_by?: string
          expires_at?: string
          created_at?: string
        }
      }
      admin_announcements: {
        Row: {
          id: string
          title: string
          content: string
          type: string | null
          is_active: boolean | null
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          content: string
          type?: string | null
          is_active?: boolean | null
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          content?: string
          type?: string | null
          is_active?: boolean | null
          created_at?: string
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
export type LightchainTaskStep = Database['public']['Tables']['lightchain_task_steps']['Row']
export type Folder = Database['public']['Tables']['folders']['Row']
export type Tag = Database['public']['Tables']['tags']['Row']
export type StylePreset = Database['public']['Tables']['style_presets']['Row']
export type ApiUsageLog = Database['public']['Tables']['api_usage_logs']['Row']
export type ShareLink = Database['public']['Tables']['share_links']['Row']
export type AdminAnnouncement = Database['public']['Tables']['admin_announcements']['Row']

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



