import type { DesignDialogueManifestReference } from '../../lib/designDialogueReferences.ts';

export type DesignScope = Readonly<{
  userId: string;
  brandId: string;
}>;

/** A caller-supplied local view of an existing canonical Canvas project. */
export type DesignProject = Readonly<{
  projectId: string;
  ownerId: string;
  brandId: string;
  conversationIds: readonly string[];
}>;

export type DesignTurnStatus = 'pending' | 'submitted' | 'unknown' | 'succeeded' | 'failed';

export type DesignTurnOutput = Readonly<{
  imageId: string;
  storagePath: string;
  jobId: string;
  candidateIndex: number;
}>;

export type DesignTurn = Readonly<{
  turnId: string;
  requestId: string;
  clientRequestKey: string;
  prompt: string;
  references: readonly Readonly<DesignDialogueManifestReference>[];
  status: DesignTurnStatus;
  jobId?: string;
  outputs: readonly DesignTurnOutput[];
  failureCode?: string;
  ackedAt?: string;
}>;

export type DesignSession = Readonly<{
  conversationId: string;
  projectId: string;
  scope: DesignScope;
  turns: readonly DesignTurn[];
}>;

export type EnsureDesignSessionInput = Readonly<{
  conversationId: string;
  projectId: string;
}>;

export type AdmitDesignTurnInput = Readonly<{
  conversationId: string;
  clientRequestKey: string;
  prompt: string;
  references: readonly DesignDialogueManifestReference[];
}>;

export type DesignTurnPatch = Readonly<{
  status?: DesignTurnStatus;
  jobId?: string;
  outputs?: readonly DesignTurnOutput[];
  failureCode?: string;
}>;

export type SessionStoreErrorCode =
  | 'scope_mismatch'
  | 'turn_input_mismatch'
  | 'invalid_input'
  | 'corrupt_record'
  | 'invalid_transition'
  | 'persist_failed'
  | 'not_found';

export class SessionStoreError extends Error {
  readonly code: SessionStoreErrorCode;

  constructor(code: SessionStoreErrorCode) {
    super(code);
    this.name = 'SessionStoreError';
    this.code = code;
  }
}
