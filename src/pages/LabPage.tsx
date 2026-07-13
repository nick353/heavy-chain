import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { BarChart3, Check, ChevronRight, FlaskConical, Images, Layers3, Lightbulb, Save, Sparkles, Target } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { MaterialWorkbench } from '../components/workspace/MaterialWorkbench';
import {
  buildMaterialReferenceMetadata,
  type MaterialReferenceState,
} from '../lib/workspaceMaterialReferences';
import { buildGenerationIntentHref, handoffWorkspaceToCanvas, workspaceSourceConfig } from '../lib/workspaceHandoff';

const choices = ['プロンプト実験', '品質評価', '採用候補'];
const fieldClass = 'mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20';
type LabExperimentCandidate = {
  id: string;
  label: string;
  hypothesis: string;
  promptDraft: string;
  evaluationAxis: string;
  candidate: string;
  score: number;
  scoreSignature: string;
  experimentMode: string;
  decision: string;
  risk: string;
};
type HistoryItem = {
  id: string;
  label: string;
};

const initialHistory: HistoryItem[] = [
  { id: 'lab-history-1', label: '素材感プロンプトを比較' },
  { id: 'lab-history-2', label: 'EC背景候補を採点' },
];

const labExperimentCandidates: LabExperimentCandidate[] = [
  {
    id: 'material-lighting',
    label: 'Material Lighting',
    hypothesis: 'シアー素材は自然光より硬めのスタジオ光で高級感が出る',
    promptDraft: 'Japanese fashion ecommerce editorial, sheer jacket, crisp studio lighting',
    evaluationAxis: '素材感 / 顔の自然さ / 商品識別性 / EC転用しやすさ',
    candidate: '候補A: 白背景スタジオ、候補B: グレー背景寄り',
    score: 84,
    scoreSignature: 'quality-84-material-lighting',
    experimentMode: 'prompt-comparison',
    decision: '硬めのスタジオ光を採用し、素材ディテールを優先する',
    risk: '光沢が強すぎると透け感が人工的に見える',
  },
  {
    id: 'retail-readiness',
    label: 'Retail Readiness',
    hypothesis: 'Smoke retail shelf test: gray background keeps garment edges readable',
    promptDraft: 'Heavy Chain retail display, sheer jacket, neutral gray studio shelf, crisp edge light',
    evaluationAxis: 'edge clarity / material sheen / campaign reuse / buyer confidence',
    candidate: 'Candidate B: gray retail shelf with crisp edge light',
    score: 88,
    scoreSignature: 'quality-88-retail-readiness',
    experimentMode: 'store-simulation',
    decision: 'Use the gray retail setup for the next EC detail generation',
    risk: 'Background props can compete with the garment tag',
  },
  {
    id: 'campaign-transfer',
    label: 'Campaign Transfer',
    hypothesis: '同じ商品画像をEC詳細とSNS縦長訴求へ転用できる',
    promptDraft: 'Heavy Chain campaign image, close crop, product texture, vertical social layout',
    evaluationAxis: 'SNS視認性 / 商品識別性 / CTA余白 / 再利用しやすさ',
    candidate: '候補C: 4:5 close crop with quiet CTA space',
    score: 79,
    scoreSignature: 'quality-79-campaign-transfer',
    experimentMode: 'campaign-reuse',
    decision: 'CTA余白を残して campaign-image に渡す',
    risk: '寄りすぎるとシルエット判断が弱くなる',
  },
];

const experimentOutputLabels: Record<string, string[]> = {
  'material-lighting': ['素材感比較', '光の採用判断', 'EC転用'],
  'retail-readiness': ['店頭想定', '輪郭確認', '詳細生成へ'],
  'campaign-transfer': ['SNS転用', 'CTA余白', '販促画像へ'],
};

const experimentIcons: Record<string, typeof FlaskConical> = {
  'material-lighting': FlaskConical,
  'retail-readiness': Target,
  'campaign-transfer': BarChart3,
};

const initialMaterialReference: MaterialReferenceState = {
  imageUrl: '',
  fileName: '',
  materialKind: '実験素材',
  maskMode: 'auto',
  activeLayer: '比較A',
  placement: '評価左',
  scale: 58,
  note: '比較したい素材や生成候補を置いて、採用判断の対象を明確にします。',
};

const labReadinessItems = [
  { label: '仮説', detail: '何を比較するかを先に決める' },
  { label: '評価', detail: 'scoreと評価軸で採用判断を残す' },
  { label: '出力', detail: '生成、Canvas、Galleryへ同じ条件で渡す' },
];

const encodeSvg = (svg: string) => {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const escapeSvgText = (value: string) => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
};

const buildLabExperimentPreviewSvg = ({
  activeChoice,
  selectedExperiment,
  hypothesis,
  promptDraft,
  evaluationAxis,
  candidate,
}: {
  activeChoice: string;
  selectedExperiment: LabExperimentCandidate;
  hypothesis: string;
  promptDraft: string;
  evaluationAxis: string;
  candidate: string;
}) => {
  const safeChoice = escapeSvgText(activeChoice);
  const safeLabel = escapeSvgText(selectedExperiment.label);
  const safeHypothesis = escapeSvgText(hypothesis.slice(0, 76));
  const safePromptDraft = escapeSvgText(promptDraft.slice(0, 76));
  const safeAxis = escapeSvgText(evaluationAxis.slice(0, 76));
  const safeCandidate = escapeSvgText(candidate.slice(0, 76));
  const safeDecision = escapeSvgText(selectedExperiment.decision.slice(0, 76));
  const safeRisk = escapeSvgText(selectedExperiment.risk.slice(0, 72));
  const primaryInput = `${hypothesis} / ${promptDraft}`;
  const nextStep = `${evaluationAxis}でlab-evaluationを採点し、${candidate}を比較する`;
  const safePrimaryInput = escapeSvgText(primaryInput.slice(0, 76));
  const safeNextStep = escapeSvgText(nextStep.slice(0, 76));
  const safeFullPrimaryInput = escapeSvgText(primaryInput);
  const safeFullNextStep = escapeSvgText(nextStep);
  const accent = selectedExperiment.id === 'retail-readiness'
    ? '#0f766e'
    : selectedExperiment.id === 'campaign-transfer'
      ? '#7c3aed'
      : '#d97706';
  const scoreWidth = Math.max(80, Math.min(360, selectedExperiment.score * 3.6));

  return encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640" data-lab-experiment="lab-evaluation-local-v1">
      <metadata>
        <lab-evaluation workflowVersion="lab-evaluation-local-v1" selectedLabExperiment="${selectedExperiment.id}" scoreSignature="${selectedExperiment.scoreSignature}" deterministicScore="${selectedExperiment.score}" primaryInput="${safeFullPrimaryInput}" nextStep="${safeFullNextStep}" />
      </metadata>
      <rect width="960" height="640" rx="36" fill="#f7f7f5"/>
      <rect x="54" y="54" width="852" height="532" rx="30" fill="#ffffff" stroke="#e5e5e5"/>
      <rect x="92" y="112" width="372" height="372" rx="28" fill="#fafafa" stroke="#d4d4d4"/>
      <path d="M144 188h122M144 236h220M144 284h170" stroke="${accent}" stroke-width="18" stroke-linecap="round"/>
      <path d="M144 368h244" stroke="#171717" stroke-width="18" stroke-linecap="round" opacity=".84"/>
      <circle cx="362" cy="184" r="54" fill="${accent}" opacity=".14"/>
      <circle cx="362" cy="184" r="34" fill="${accent}" opacity=".82"/>
      <rect x="136" y="420" width="292" height="22" rx="11" fill="#e5e5e5"/>
      <rect x="136" y="420" width="${scoreWidth}" height="22" rx="11" fill="${accent}"/>
      <text x="144" y="474" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" fill="#171717">deterministic-score:${selectedExperiment.score}</text>
      <text x="144" y="506" font-family="Inter, Arial, sans-serif" font-size="15" fill="#737373">scoreSignature:${selectedExperiment.scoreSignature}</text>
      <text x="560" y="138" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="${accent}">${safeChoice}</text>
      <text x="560" y="188" font-family="Inter, Arial, sans-serif" font-size="40" font-weight="800" fill="#171717">${safeLabel}</text>
      <text x="560" y="242" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">hypothesis: ${safeHypothesis}</text>
      <text x="560" y="286" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">prompt: ${safePromptDraft}</text>
      <text x="560" y="330" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">axis: ${safeAxis}</text>
      <text x="560" y="374" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">candidate: ${safeCandidate}</text>
      <text x="560" y="418" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">decision: ${safeDecision}</text>
      <text x="560" y="462" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">risk: ${safeRisk}</text>
      <text x="560" y="520" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" fill="#171717">Primary input</text>
      <text x="560" y="546" font-family="Inter, Arial, sans-serif" font-size="16" fill="#525252">${safePrimaryInput}</text>
      <text x="560" y="576" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" fill="#171717">Next step</text>
      <text x="560" y="602" font-family="Inter, Arial, sans-serif" font-size="16" fill="#525252">${safeNextStep}</text>
      <text x="92" y="552" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#171717">selected-lab-experiment:${selectedExperiment.id}</text>
      <text x="92" y="580" font-family="Inter, Arial, sans-serif" font-size="16" fill="#737373">workflowVersion:lab-evaluation-local-v1</text>
    </svg>
  `);
};

export function LabPage() {
  const navigate = useNavigate();
  const { currentBrand } = useAuthStore();
  const [activeChoice, setActiveChoice] = useState(choices[0]);
  const [progress, setProgress] = useState(28);
  const [history, setHistory] = useState(initialHistory);
  const [selectedExperimentId, setSelectedExperimentId] = useState(labExperimentCandidates[0].id);
  const [hypothesis, setHypothesis] = useState('シアー素材は自然光より硬めのスタジオ光で高級感が出る');
  const [promptDraft, setPromptDraft] = useState('Japanese fashion ecommerce editorial, sheer jacket, crisp studio lighting');
  const [evaluationAxis, setEvaluationAxis] = useState('素材感 / 顔の自然さ / 商品識別性 / EC転用しやすさ');
  const [candidate, setCandidate] = useState('候補A: 白背景スタジオ、候補B: グレー背景寄り');
  const [materialReference, setMaterialReference] = useState<MaterialReferenceState>(initialMaterialReference);
  const nextHistoryId = useRef(3);
  const selectedExperiment = labExperimentCandidates.find((item) => item.id === selectedExperimentId) ?? labExperimentCandidates[0];
  const axisItems = evaluationAxis.split('/').map((item) => item.trim()).filter(Boolean);
  const previewImageUrl = useMemo(() => buildLabExperimentPreviewSvg({
    activeChoice,
    selectedExperiment,
    hypothesis,
    promptDraft,
    evaluationAxis,
    candidate,
  }), [activeChoice, candidate, evaluationAxis, hypothesis, promptDraft, selectedExperiment]);

  const recordProgress = (choice: string) => {
    const historyItem = {
      id: `lab-history-${nextHistoryId.current++}`,
      label: `${choice}をローカル履歴に追加`,
    };

    setActiveChoice(choice);
    setProgress((current) => Math.min(current + 18, 98));
    setHistory((items) => [historyItem, ...items].slice(0, 4));
  };

  const selectExperiment = (experiment: LabExperimentCandidate) => {
    setSelectedExperimentId(experiment.id);
    setHypothesis(experiment.hypothesis);
    setPromptDraft(experiment.promptDraft);
    setEvaluationAxis(experiment.evaluationAxis);
    setCandidate(experiment.candidate);
  };

  const handoffToCanvas = () => {
    if (!currentBrand) {
      toast.error('ブランドを読み込んでからもう一度試してください');
      return;
    }

    const note = history[0]?.label ?? 'ローカルメモなし';
    const primaryInput = `${hypothesis} / ${promptDraft}`;
    const nextStep = `${evaluationAxis}でlab-evaluationを採点し、${candidate}を比較する`;
    const generationSource = {
      sourceWorkspace: 'lab' as const,
      workflowVersion: 'lab-evaluation-local-v1',
      sourceLabel: workspaceSourceConfig.lab.label,
      sourceResumePath: workspaceSourceConfig.lab.resumePath,
      sourceMode: 'local-workflow-intake' as const,
    };
    const selectedLabExperimentMetadata = {
      id: selectedExperiment.id,
      label: selectedExperiment.label,
      hypothesis,
      promptDraft,
      evaluationAxis,
      candidate,
      deterministicScore: selectedExperiment.score,
      scoreSignature: selectedExperiment.scoreSignature,
      experimentMode: selectedExperiment.experimentMode,
      decision: selectedExperiment.decision,
      risk: selectedExperiment.risk,
    };
    const materialReferenceMetadata = buildMaterialReferenceMetadata(materialReference);
    const materialReferenceSummary = materialReferenceMetadata.hasImage
      ? `${materialReferenceMetadata.materialKind}: ${materialReferenceMetadata.fileName ?? 'uploaded'} / ${materialReferenceMetadata.activeLayer} / ${materialReferenceMetadata.placement} / ${materialReferenceMetadata.scale}%`
      : '素材を追加するとここに反映されます';
    const generationPrompt = [
      promptDraft,
      `Hypothesis: ${hypothesis}`,
      `Evaluation axis: ${evaluationAxis}`,
      `Candidate direction: ${candidate}`,
      `Experiment: ${selectedExperiment.label}`,
      `Deterministic score: ${selectedExperiment.score}`,
      `Decision: ${selectedExperiment.decision}`,
      `Material reference: ${materialReferenceSummary}`,
    ].join('\n');
    const prompt = [
      `Primary input: ${primaryInput}`,
      `Hypothesis: ${hypothesis}`,
      `Prompt draft: ${promptDraft}`,
      `Evaluation axis: ${evaluationAxis}`,
      `Candidate: ${candidate}`,
      `Selected experiment: ${selectedExperiment.label}`,
      `Deterministic score: ${selectedExperiment.score}`,
      `Score signature: ${selectedExperiment.scoreSignature}`,
      `Decision: ${selectedExperiment.decision}`,
      `Risk: ${selectedExperiment.risk}`,
      `Material reference: ${materialReferenceSummary}`,
      `Next step: ${nextStep}`,
    ].join('\n');
    const { projectId } = handoffWorkspaceToCanvas({
      brandId: currentBrand.id,
      featureType: 'lab-workflow',
      projectName: `Lab: ${activeChoice}`,
      title: `Lab: ${activeChoice}`,
      prompt,
      imageUrl: materialReference.imageUrl || previewImageUrl,
      summary: `${activeChoice}の進捗 ${progress}%`,
      note,
      activeChoice,
      progress,
      history: history.map((item) => item.label),
      workflow: {
        workflowVersion: 'lab-evaluation-local-v1',
        inputs: {
          hypothesis,
          promptDraft,
          evaluationAxis,
          candidate,
          selectedLabExperiment: selectedLabExperimentMetadata,
          materialReference: materialReferenceMetadata,
        },
        plan: {
          labEvaluation: 'lab-evaluation',
          scoringAxis: evaluationAxis,
          selectedLabExperiment: selectedLabExperimentMetadata,
          deterministicScore: selectedExperiment.score,
          materialReference: materialReferenceMetadata,
          preview: {
            previewKind: 'deterministic-svg',
            marker: 'selected-lab-experiment',
            imageUrl: previewImageUrl,
          },
          nextStep,
          searchTokens: ['lab-evaluation', 'lab-evaluation-local-v1', activeChoice, selectedExperiment.id, candidate],
        },
        status: 'planned',
        resumePath: '/lab',
        handoffKind: 'local-workflow-intake',
        primaryInput,
        nextStep,
        generationIntent: {
          feature: 'campaign-image',
          prompt: generationPrompt,
          href: buildGenerationIntentHref({
            feature: 'campaign-image',
            prompt: generationPrompt,
            ...generationSource,
          }),
          label: 'キャンペーン画像で生成',
          ...generationSource,
          materialReferences: [materialReferenceMetadata],
          layerPlan: {
            activeLayer: materialReference.activeLayer,
            placement: materialReference.placement,
            scale: materialReference.scale,
          },
          maskPlan: {
            maskMode: materialReference.maskMode,
          },
          compositionPreview: {
            selectedExperimentId: selectedExperiment.id,
            hasUploadedMaterial: Boolean(materialReference.imageUrl),
            placement: materialReference.placement,
          },
        },
      },
      previewMetadata: {
        selectedLabExperiment: selectedLabExperimentMetadata,
        previewKind: 'deterministic-svg',
        marker: 'selected-lab-experiment',
        imageUrl: previewImageUrl,
        materialReference: materialReferenceMetadata,
      },
      selectedLabExperiment: selectedLabExperimentMetadata,
      materialReferences: [materialReferenceMetadata],
      layerPlan: {
        activeLayer: materialReference.activeLayer,
        placement: materialReference.placement,
        scale: materialReference.scale,
      },
      maskPlan: {
        maskMode: materialReference.maskMode,
      },
      compositionPreview: {
        selectedExperimentId: selectedExperiment.id,
        hasUploadedMaterial: Boolean(materialReference.imageUrl),
        placement: materialReference.placement,
      },
      metadata: {
        workspace: 'lab',
        searchTokens: ['lab-evaluation', 'lab-workflow', 'lab-evaluation-local-v1', activeChoice, selectedExperiment.id],
        selectedLabExperiment: selectedLabExperimentMetadata,
        materialReferences: [materialReferenceMetadata],
      },
    });

    toast.success('Labを保存し、Canvasへ渡しました');
    navigate(`/canvas/${projectId}`);
  };

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold text-neutral-950 dark:text-white">
              ウェアデザインラボ
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              服の方向性、素材感、採用候補を比べて、生成指示かCanvasへそのまま渡す場所です。
            </p>
          </div>
          <button
            type="button"
            onClick={handoffToCanvas}
            disabled={!currentBrand}
            className="btn-secondary inline-flex items-center justify-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            保存してCanvasへ
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {choices.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => recordProgress(choice)}
              className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                activeChoice === choice
                  ? 'border-cyan-300 bg-cyan-300 text-neutral-950 dark:border-cyan-300 dark:bg-cyan-300 dark:text-neutral-950'
                  : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:border-cyan-300/50 hover:bg-white/[0.07]'
              }`}
            >
              {choice}
            </button>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">実験レーンを選ぶ</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                候補を見比べながら、仮説・評価軸・採用判断を先に選びます。
              </p>
            </div>
            <span className="w-fit rounded-full bg-cyan-300/15 px-3 py-1 text-xs font-semibold text-cyan-100 ring-1 ring-cyan-300/30">
              score {selectedExperiment.score}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {labExperimentCandidates.map((experiment) => {
              const isSelected = selectedExperiment.id === experiment.id;
              const Icon = experimentIcons[experiment.id] ?? Lightbulb;

              return (
                <button
                  key={experiment.id}
                  type="button"
                  onClick={() => selectExperiment(experiment)}
                  aria-pressed={isSelected}
                  className={`rounded-2xl border p-4 text-left transition ${
                    isSelected
                      ? 'border-cyan-300 bg-cyan-300 text-neutral-950 ring-2 ring-cyan-300/20 dark:border-cyan-300 dark:bg-cyan-300 dark:ring-cyan-300/20'
                      : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:border-cyan-300/50 hover:bg-white/[0.07]'
                  }`}
                >
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    isSelected
                      ? 'bg-cyan-300 text-neutral-950'
                      : 'bg-white/[0.06] text-neutral-300'
                  }`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="mt-3 flex items-center justify-between gap-3 text-sm font-semibold text-neutral-950 dark:text-white">
                    {experiment.label}
                    {isSelected && <Check className="h-4 w-4 text-cyan-300 dark:text-cyan-300" />}
                  </span>
                  <span className="mt-2 block text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                    {experiment.decision}
                  </span>
                  <span className="mt-3 flex flex-wrap gap-1.5">
                    {(experimentOutputLabels[experiment.id] ?? []).map((output) => (
                      <span key={output} className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-neutral-500 ring-1 ring-neutral-200 dark:bg-surface-900 dark:text-neutral-300 dark:ring-white/10">
                        {output}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section
        data-testid="lab-action-panel"
        className="grid gap-4 rounded-2xl border border-cyan-300/35 bg-cyan-300/[0.08] p-5 dark:border-cyan-300/30 dark:bg-cyan-300/[0.08] lg:grid-cols-[minmax(0,1fr)_auto]"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300 dark:text-cyan-300">
            Wear Design Lab
          </p>
          <h2 className="mt-2 text-lg font-semibold text-neutral-950 dark:text-white">
            まず素材や候補を置き、良い方向だけを生成へ進める
          </h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {labReadinessItems.map((item) => (
              <div
                key={item.label}
                data-testid="lab-readiness-item"
                className="rounded-xl border border-white/70 bg-white/70 p-3 text-sm dark:border-white/10 dark:bg-surface-900/60"
              >
                <p className="font-semibold text-neutral-950 dark:text-white">{item.label}</p>
                <p className="mt-1 leading-5 text-neutral-600 dark:text-neutral-300">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
        <div
          data-testid="lab-next-actions"
          className="flex flex-col gap-2 sm:flex-row lg:min-w-64 lg:flex-col lg:justify-center"
        >
          <Link
            to={buildGenerationIntentHref({
              feature: 'campaign-image',
              prompt: `${promptDraft}\nHypothesis: ${hypothesis}\nEvaluation axis: ${evaluationAxis}\nCandidate direction: ${candidate}`,
              sourceWorkspace: 'lab',
              workflowVersion: 'lab-evaluation-local-v1',
              sourceLabel: workspaceSourceConfig.lab.label,
              sourceResumePath: workspaceSourceConfig.lab.resumePath,
              sourceMode: 'local-workflow-intake',
            })}
            className="btn-primary inline-flex items-center justify-center gap-2 text-sm"
          >
            <Sparkles className="h-4 w-4" />
            ラボで試す
          </Link>
          <button
            type="button"
            onClick={handoffToCanvas}
            disabled={!currentBrand}
            className="btn-secondary inline-flex items-center justify-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Layers3 className="h-4 w-4" />
            Canvasへ保存
          </button>
          <Link to="/gallery" className="btn-secondary inline-flex items-center justify-center gap-2 text-sm">
            <Images className="h-4 w-4" />
            Galleryで確認
          </Link>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
          <MaterialWorkbench
            title="実験ワークベンチ"
            description="生成候補、物撮り素材、参考LOOKを置き、評価対象と比較レイヤーを視覚的に決めます。"
            uploadLabel="実験素材・生成候補をアップロード"
            emptyLabel="素材を置くと、Canvasへ評価対象の実画像レイヤーとして渡せます"
            state={materialReference}
            onChange={setMaterialReference}
            materialKinds={['実験素材', '生成候補', '物撮り', '参考LOOK', '失敗例']}
            layerOptions={['比較A', '比較B', '採用候補', '除外候補', '評価メモ']}
            placementOptions={['評価左', '評価右', '中央比較', '採用枠', '再実験枠']}
          />
        </div>
        <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">仮説と評価条件を整える</h2>
          <p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
            選んだ実験レーンをもとに、仮説・プロンプト案・評価軸・採用候補だけを調整します。
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              仮説
              <textarea value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} rows={3} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              プロンプト案
              <textarea value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} rows={3} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              評価軸
              <textarea value={evaluationAxis} onChange={(event) => setEvaluationAxis(event.target.value)} rows={3} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              採用候補
              <textarea value={candidate} onChange={(event) => setCandidate(event.target.value)} rows={3} className={fieldClass} />
            </label>
          </div>
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">ローカル進捗</h2>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{activeChoice} / {progress}%</p>
          <div className="mt-4 h-2 rounded-full bg-surface-200 dark:bg-surface-800">
            <div className="h-full rounded-full bg-cyan-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-4 text-sm font-semibold text-neutral-900 dark:text-white">
            決定的スコア {selectedExperiment.score}
          </p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{selectedExperiment.scoreSignature}</p>
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">履歴</h2>
          <div className="mt-4 space-y-3">
            {history.map((item) => (
              <div key={item.id} className="rounded-xl bg-white/60 p-3 text-sm text-neutral-700 dark:bg-surface-900/50 dark:text-neutral-300">
                {item.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">評価プレビュー</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{selectedExperiment.label} / score {selectedExperiment.score}</p>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <figure className="lg:row-span-2">
              <img
                data-testid="lab-preview-image"
                src={previewImageUrl}
                alt="Lab evaluation preview"
                className="aspect-[3/2] w-full rounded-2xl border border-neutral-200 bg-white object-cover dark:border-white/10 dark:bg-surface-900"
              />
              <figcaption className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
                仮説、評価軸、採用候補、次アクションを生成前に確認するローカル評価プレビューです。
              </figcaption>
            </figure>
            <div className="rounded-2xl border border-neutral-200 bg-white/70 p-4 dark:border-white/10 dark:bg-surface-950/40">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">決定的スコア</p>
              <div className="mt-3 flex items-end gap-2">
                <span className="text-5xl font-semibold text-neutral-950 dark:text-white">{selectedExperiment.score}</span>
                <span className="pb-1 text-sm font-semibold text-neutral-400">/ 100</span>
              </div>
              <div className="mt-4 h-2 rounded-full bg-surface-200 dark:bg-surface-800">
                <div className="h-full rounded-full bg-cyan-300" style={{ width: `${selectedExperiment.score}%` }} />
              </div>
              <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">{selectedExperiment.scoreSignature}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-neutral-200 bg-white/70 p-4 dark:border-white/10 dark:bg-surface-950/40">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">採用判断</p>
                <p className="mt-2 text-sm leading-6 text-neutral-800 dark:text-neutral-100">{selectedExperiment.decision}</p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-white/70 p-4 dark:border-white/10 dark:bg-surface-950/40">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">注意点</p>
                <p className="mt-2 text-sm leading-6 text-neutral-800 dark:text-neutral-100">{selectedExperiment.risk}</p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-white/70 p-4 dark:border-white/10 dark:bg-surface-950/40 md:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">評価軸</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {axisItems.map((axis) => (
                    <span key={axis} className="rounded-full bg-surface-100 px-3 py-1 text-xs font-medium text-neutral-600 dark:bg-surface-800 dark:text-neutral-300">
                      {axis}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
