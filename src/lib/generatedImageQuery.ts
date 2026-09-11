/**
 * Columns required by Gallery, Library, Fitting history, Jobs, and the
 * Lightchain material pickers. Keep large generation-only fields out of
 * list/history reads; detail and provider workflows can request them when
 * they are actually needed.
 */
import type { GeneratedImage } from '../types/database';

export type GeneratedImageListRow = Pick<GeneratedImage,
  | 'id'
  | 'job_id'
  | 'brand_id'
  | 'user_id'
  | 'storage_path'
  | 'image_url'
  | 'is_favorite'
  | 'created_at'
  | 'prompt'
  | 'feature_type'
  | 'style_preset'
  | 'model_used'
  | 'metadata'
>;

export const GENERATED_IMAGE_LIST_COLUMNS = 'id,job_id,brand_id,user_id,storage_path,image_url,is_favorite,created_at,prompt,feature_type,style_preset,model_used,metadata' as const;

export type GeneratedImageGallerySelectorRow = Pick<GeneratedImage,
  | 'id'
  | 'job_id'
  | 'brand_id'
  | 'user_id'
  | 'storage_path'
  | 'image_url'
  | 'is_favorite'
  | 'created_at'
  | 'prompt'
  | 'negative_prompt'
  | 'feature_type'
  | 'generation_params'
  | 'metadata'
>;

export const GENERATED_IMAGE_GALLERY_SELECTOR_COLUMNS = 'id,job_id,brand_id,user_id,storage_path,image_url,is_favorite,created_at,prompt,negative_prompt,feature_type,generation_params,metadata' as const;

export const toGeneratedImageListRow = (image: GeneratedImage): GeneratedImageListRow => ({
  id: image.id,
  job_id: image.job_id,
  brand_id: image.brand_id,
  user_id: image.user_id,
  storage_path: image.storage_path,
  image_url: image.image_url,
  is_favorite: image.is_favorite,
  created_at: image.created_at,
  prompt: image.prompt,
  feature_type: image.feature_type,
  style_preset: image.style_preset,
  model_used: image.model_used,
  metadata: image.metadata,
});
