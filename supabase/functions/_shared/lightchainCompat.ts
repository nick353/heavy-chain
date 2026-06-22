export interface LightchainCompatMetadata {
  lightchainFeatureId: string;
  lightchainFeatureTitle: string;
  lightchainTaskCodes: string[];
  lightchainTaskSteps: LightchainTaskStep[];
}

export interface LightchainTaskStep {
  taskCode: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'retryable';
}

type LightchainTaskStepStatus = LightchainTaskStep['status'];

type JsonRecord = Record<string, unknown>;
type SupabaseWriteClient = {
  from: (table: 'lightchain_task_steps') => {
    insert: (rows: LightchainTaskStepInsert[]) => unknown;
  };
};

interface LightchainTaskStepInsert {
  job_id: string;
  image_id?: string | null;
  brand_id: string;
  user_id: string;
  lightchain_feature_id: string;
  lightchain_feature_title: string;
  task_code: string;
  step_index: number;
  status: LightchainTaskStepStatus;
  source_workspace?: string | null;
  workflow_version?: string | null;
  request_id?: string | null;
  artifact_uri?: string | null;
  error_message?: string | null;
  metadata?: JsonRecord;
  completed_at?: string | null;
}

interface PersistLightchainTaskStepsOptions {
  supabaseClient: SupabaseWriteClient;
  lightchainMetadata: LightchainCompatMetadata | null;
  jobId: string | null;
  imageId?: string | null;
  brandId: string;
  userId: string;
  status: LightchainTaskStepStatus;
  sourceMetadata?: JsonRecord | null;
  requestId?: string | null;
  artifactUri?: string | null;
  errorMessage?: string | null;
}

const isRecord = (value: unknown): value is JsonRecord => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const readTrimmedString = (record: JsonRecord, key: string, maxLength: number) => {
  const value = record[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
};

const LIGHTCHAIN_FEATURE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,80}$/;
const LIGHTCHAIN_TASK_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_ -]{0,63}$/;

export const sanitizeLightchainCompat = (value: unknown): LightchainCompatMetadata | null => {
  if (!isRecord(value)) return null;

  const lightchainFeatureId = readTrimmedString(value, 'lightchainFeatureId', 80);
  const lightchainFeatureTitle = readTrimmedString(value, 'lightchainFeatureTitle', 120);
  const rawTaskCodes = value.lightchainTaskCodes;

  if (!lightchainFeatureId || !LIGHTCHAIN_FEATURE_ID_PATTERN.test(lightchainFeatureId)) return null;
  if (!lightchainFeatureTitle || !Array.isArray(rawTaskCodes)) return null;

  const lightchainTaskCodes = [...new Set(rawTaskCodes
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 64 && LIGHTCHAIN_TASK_CODE_PATTERN.test(item))
  )].slice(0, 12);

  if (!lightchainTaskCodes.length) return null;

  return {
    lightchainFeatureId,
    lightchainFeatureTitle,
    lightchainTaskCodes,
    lightchainTaskSteps: lightchainTaskCodes.map((taskCode) => ({
      taskCode,
      status: 'processing',
    })),
  };
};

export const withLightchainTaskStepStatus = (
  metadata: LightchainCompatMetadata | null,
  status: LightchainTaskStepStatus,
): LightchainCompatMetadata | null => {
  if (!metadata) return null;
  return {
    ...metadata,
    lightchainTaskSteps: metadata.lightchainTaskCodes.map((taskCode) => ({
      taskCode,
      status,
    })),
  };
};

export const persistLightchainTaskSteps = async ({
  supabaseClient,
  lightchainMetadata,
  jobId,
  imageId = null,
  brandId,
  userId,
  status,
  sourceMetadata = null,
  requestId = null,
  artifactUri = null,
  errorMessage = null,
}: PersistLightchainTaskStepsOptions) => {
  if (!lightchainMetadata || !jobId || !brandId || !userId) return;

  const sourceWorkspace = readTrimmedString(sourceMetadata ?? {}, 'sourceWorkspace', 80);
  const workflowVersion = readTrimmedString(sourceMetadata ?? {}, 'workflowVersion', 120);
  const completedAt = status === 'completed' || status === 'failed' || status === 'retryable'
    ? new Date().toISOString()
    : null;
  const rows = lightchainMetadata.lightchainTaskCodes.map((taskCode, index) => ({
    job_id: jobId,
    image_id: imageId,
    brand_id: brandId,
    user_id: userId,
    lightchain_feature_id: lightchainMetadata.lightchainFeatureId,
    lightchain_feature_title: lightchainMetadata.lightchainFeatureTitle,
    task_code: taskCode,
    step_index: index,
    status,
    source_workspace: sourceWorkspace,
    workflow_version: workflowVersion,
    request_id: requestId,
    artifact_uri: artifactUri,
    error_message: errorMessage,
    metadata: {
      lightchainFeatureId: lightchainMetadata.lightchainFeatureId,
      lightchainFeatureTitle: lightchainMetadata.lightchainFeatureTitle,
    },
    completed_at: completedAt,
  }));

  try {
    const { error } = await supabaseClient.from('lightchain_task_steps').insert(rows) as { error: { message?: string } | null };
    if (error) {
      console.warn('Lightchain task step persistence skipped:', error.message ?? 'unknown error');
    }
  } catch (error) {
    console.warn('Lightchain task step persistence skipped:', error instanceof Error ? error.message : 'unknown error');
  }
};
