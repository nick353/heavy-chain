import { CheckCircle2 } from 'lucide-react';

import type {
  PrintGarmentMaskCandidate,
} from '../../lib/workspaceMaterialReferences';
import type {
  PrintGarmentMaskCandidateId,
} from '../../lib/printMaskCandidateStrategy';

export function PrintMaskCandidatePicker({
  candidates,
  selectedCandidateId,
  onSelect,
  disabled = false,
}: {
  candidates: PrintGarmentMaskCandidate[];
  selectedCandidateId: PrintGarmentMaskCandidateId;
  onSelect: (candidateId: PrintGarmentMaskCandidateId) => void;
  disabled?: boolean;
}) {
  if (!candidates.length) return null;

  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div>
        <h3 className="text-sm font-semibold text-white">切り抜きマスクを選ぶ</h3>
        <p className="mt-1 text-xs leading-5 text-white/50">
          自動結果を比べて、服の輪郭が最も自然な候補を選んでください。
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="切り抜きマスク候補"
        className="grid gap-2 sm:grid-cols-3"
      >
        {candidates.map((candidate) => {
          const selected = candidate.candidateId === selectedCandidateId;
          return (
            <button
              key={candidate.candidateId}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onSelect(candidate.candidateId)}
              className={`overflow-hidden rounded-xl border text-left transition ${selected
                ? 'border-cyan-300/70 bg-cyan-300/10'
                : 'border-white/10 bg-black/20 hover:border-white/25'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <div className="relative aspect-square bg-[linear-gradient(45deg,rgba(255,255,255,0.08)_25%,transparent_25%),linear-gradient(-45deg,rgba(255,255,255,0.08)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,rgba(255,255,255,0.08)_75%),linear-gradient(-45deg,transparent_75%,rgba(255,255,255,0.08)_75%)] bg-[length:16px_16px]">
                <img
                  src={candidate.result.dataUrl}
                  alt={`${candidate.label}の切り抜きプレビュー`}
                  className="h-full w-full object-contain"
                />
                {selected && (
                  <CheckCircle2 className="absolute right-2 top-2 h-5 w-5 text-cyan-200 drop-shadow" />
                )}
              </div>
              <div className="p-2.5">
                <div className="text-xs font-semibold text-white">{candidate.label}</div>
                <div className="mt-1 text-[11px] leading-4 text-white/50">{candidate.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
