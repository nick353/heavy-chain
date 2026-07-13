import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Database as AppDatabase } from '../../../src/types/database.ts';

export type BrandRole = 'viewer' | 'editor' | 'admin' | 'owner';

type EmptyRecord = { [_ in never]: never };
type EdgeTable<Table> = Table & { Relationships: [] };
type EdgeTables<Tables> = {
  [TableName in keyof Tables]: EdgeTable<Tables[TableName]>;
};

export type Database = {
  public: {
    Tables: EdgeTables<AppDatabase['public']['Tables']>;
    Views: AppDatabase['public'] extends { Views: infer Views } ? Views : EmptyRecord;
    Functions: AppDatabase['public'] extends { Functions: infer Functions } ? Functions : EmptyRecord;
    Enums: AppDatabase['public'] extends { Enums: infer Enums } ? Enums : EmptyRecord;
    CompositeTypes: AppDatabase['public'] extends { CompositeTypes: infer CompositeTypes } ? CompositeTypes : EmptyRecord;
  };
};

export type AppSupabaseClient = SupabaseClient<Database>;

const roleRank: Record<BrandRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

export function createUserClient(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new Error('Unauthorized');
  }

  return createClient<Database>(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );
}

export function createServiceClient() {
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) {
    throw new Error('Service role key not configured');
  }

  return createClient<Database>(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

export async function requireUser(supabaseClient: AppSupabaseClient) {
  const { data: { user }, error } = await supabaseClient.auth.getUser();
  if (error || !user) {
    throw new Error('Unauthorized');
  }
  return user;
}

function hasRole(role: BrandRole, minimumRole: BrandRole) {
  return roleRank[role] >= roleRank[minimumRole];
}

export async function requireBrandRole(
  supabaseClient: AppSupabaseClient,
  brandId: string,
  userId: string,
  minimumRole: BrandRole,
) {
  const { data: brand, error: brandError } = await supabaseClient
    .from('brands')
    .select('id, owner_id')
    .eq('id', brandId)
    .single();

  if (brandError || !brand) {
    throw new Error('Brand not found or access denied');
  }

  if (brand.owner_id === userId) {
    return { brandId, role: 'owner' as BrandRole };
  }

  const { data: membership, error: memberError } = await supabaseClient
    .from('brand_members')
    .select('role, joined_at')
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .not('joined_at', 'is', null)
    .single();

  if (memberError || !membership || !hasRole(membership.role as BrandRole, minimumRole)) {
    throw new Error('Insufficient brand permissions');
  }

  return { brandId, role: membership.role as BrandRole };
}

export async function requireImageRole(
  supabaseClient: AppSupabaseClient,
  imageId: string,
  userId: string,
  minimumRole: BrandRole,
) {
  const { data: image, error } = await supabaseClient
    .from('generated_images')
    .select('id, brand_id, storage_path, image_url')
    .eq('id', imageId)
    .single();

  if (error || !image) {
    throw new Error('Image not found or access denied');
  }

  await requireBrandRole(supabaseClient, image.brand_id, userId, minimumRole);
  return image;
}

export async function requireFolderRole(
  supabaseClient: AppSupabaseClient,
  folderId: string,
  userId: string,
  minimumRole: BrandRole,
) {
  const { data: folder, error } = await supabaseClient
    .from('folders')
    .select('id, brand_id')
    .eq('id', folderId)
    .single();

  if (error || !folder) {
    throw new Error('Folder not found or access denied');
  }

  await requireBrandRole(supabaseClient, folder.brand_id, userId, minimumRole);
  return folder;
}

export function clientError(error: unknown) {
  return error instanceof Error ? error.message : 'Request failed';
}
