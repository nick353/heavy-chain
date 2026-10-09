import { ChevronLeft, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCanonicalImageWorkspace } from '../hooks/useCanonicalImageWorkspace';
import { CanonicalImageWorkspaceControls } from '../components/CanonicalImageWorkspaceControls';
import { projectNameFromFile } from '../lib/projectNames';

const LIGHTCHAIN_LAB_PROJECT_ICON = '/lightchain-assets/icons/laboratory.png';

/**
 * Light Chain's laboratory detail route is intentionally a minimal empty
 * canvas. Keep it separate from the richer local LabPage so the canonical
 * deep-link has the same first state as the source site.
 */
export function LightchainLabDetailPage() {
  const workspace = useCanonicalImageWorkspace('lab');
  const imageUrl = workspace.result?.imageUrl ?? workspace.slots.primary?.imageUrl;

  return (
    <main
      className="dark relative min-h-[calc(100vh-50px)] overflow-hidden bg-[#181a1d] text-white"
      data-testid="lightchain-lab-detail"
      data-lightchain-parity-shell="lab-detail"
      data-resume-job={workspace.result?.jobId ?? ''}
      data-resume-state={workspace.status}
      data-resume-inputs={String(workspace.originalInputsAvailable)}
      data-current-inputs={String(workspace.inputsAvailable)}
      data-primary-source={workspace.slots.primary?.sourceImageId ?? workspace.slots.primary?.localAssetRef ?? ''}
      data-secondary-source={workspace.slots.secondary?.sourceImageId ?? workspace.slots.secondary?.localAssetRef ?? ''}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{ backgroundImage: 'radial-gradient(#464b50 1px, transparent 1px)', backgroundSize: '18px 18px' }}
      />
      <aside className="absolute left-4 top-6 z-10 flex h-[84px] w-[264px] flex-col gap-y-2 overflow-hidden rounded-xl border border-white/10 bg-[#202426] p-2 text-neutral-200 shadow-xl">
        <div className="text-sm text-neutral-400"><img src={LIGHTCHAIN_LAB_PROJECT_ICON} alt="" className="mr-1 inline-block size-5 rounded object-contain" />Heavy Chain Lab</div>
        <div className="h-px w-full bg-white/10" />
        <Link
          to="/flow/laboratory"
          aria-label="Heavy Chain Labへ戻る"
          className="flex w-fit items-center gap-2 text-base text-neutral-400 transition hover:text-white"
        >
          <ChevronLeft className="h-5 w-5" />
          <div className="h-full w-px bg-transparent" />
          <span className="rounded-sm px-1 py-1">{projectNameFromFile(workspace.slots.primary?.name)}</span>
        </Link>
      </aside>
      <label
        className="absolute left-1/2 top-[158px] flex h-[554px] w-[min(768px,calc(100vw-40px))] -translate-x-1/2 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-[#25292b] text-center transition hover:bg-[#2a2e30]"
        data-testid="lightchain-lab-detail-upload"
      >
        {imageUrl ? (
          <img src={imageUrl} alt="アップロードしたラボ素材" className="h-full w-full rounded-xl object-contain" />
        ) : (
          <>
            <Upload className="h-8 w-8 text-white" />
            <p className="relative top-[8px] mt-5 text-sm leading-[21px] text-neutral-300">ここをクリックまたはドラッグして画像を追加</p>
            <p className="relative top-[8px] mt-1 text-xs leading-[17.14px] text-neutral-500">jpg、jpeg、png、webp形式の画像（最大20M）に対応</p>
          </>
        )}
        {workspace.slots.primary && <span className="sr-only" role="status">{`主素材画像: ${workspace.slots.primary.name}`}</span>}
        <input disabled={workspace.status==='loading'||workspace.status==='running'||Boolean(workspace.pendingId)} className="sr-only" type="file" aria-label="主素材画像" accept=".png,.jpg,.jpeg,.avif,.webp" onChange={event=>{const file=event.target.files?.[0];if(file)void workspace.upload('primary',file);event.target.value='';}} />
      </label>
      <CanonicalImageWorkspaceControls workspace={workspace} />
    </main>
  );
}
