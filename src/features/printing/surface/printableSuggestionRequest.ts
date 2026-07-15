export type PrintableSuggestionCommitToken = {
  requestId: number;
  garmentUrl: string;
  candidateId: string;
  garmentMaskRevision: number;
  cutoutRequestId: number;
  outputWidth: number;
  outputHeight: number;
};

export const canCommitPrintableSuggestion = (
  captured: PrintableSuggestionCommitToken,
  current: PrintableSuggestionCommitToken,
) => (
  captured.requestId === current.requestId
  && captured.garmentUrl === current.garmentUrl
  && captured.candidateId === current.candidateId
  && captured.garmentMaskRevision === current.garmentMaskRevision
  && captured.cutoutRequestId === current.cutoutRequestId
  && captured.outputWidth === current.outputWidth
  && captured.outputHeight === current.outputHeight
);

export const canCommitPrintableSurfaceEditorOperation = (
  capturedOperationId: number,
  currentOperationId: number,
) => capturedOperationId === currentOperationId;
