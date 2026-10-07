import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';

export type DesignCreationCardProps = {
  icon: ReactNode;
  title: string;
  actionLabel: string;
  onClick: () => void;
};

const actionButtonWidths: Record<string, string> = {
  デザインプロジェクトを新規作成: 'w-[228px]',
  プリントプロジェクトを新規作成: 'w-[228px]',
  生地プロジェクトを新規作成: 'w-[204px]',
  企画提案書を新規作成: 'w-[168px]',
};

const posterPairs: Record<string, readonly [string, string]> = {
  デザインプロジェクトを新規作成: ['/design-card-assets/clothing2.png', '/design-card-assets/clothing1.png'],
  プリントプロジェクトを新規作成: ['/design-card-assets/print2.png', '/design-card-assets/print1.png'],
  生地プロジェクトを新規作成: ['/design-card-assets/fabric2.png', '/design-card-assets/fabric1.png'],
  企画提案書を新規作成: ['/design-card-assets/techpack2.png', '/design-card-assets/techpack1.png'],
};

const firstPosterClass = 'absolute top-[72px] left-[60px] w-[100px] h-[128px] rounded-[2px] opacity-0 rotate-0 group-hover:opacity-100 group-hover:translate-x-[39px] group-hover:-translate-y-[48px] group-hover:rotate-[5deg] transition-all duration-[301ms] ease-[cubic-bezier(0.5,0,0.5,1)] pointer-events-none';
const secondPosterClass = 'absolute top-[80px] left-[60px] w-[100px] h-[128px] rounded-[2px] opacity-0 rotate-0 group-hover:opacity-100 group-hover:-translate-x-[33px] group-hover:-translate-y-[48px] group-hover:-rotate-[10deg] transition-all duration-[301ms] ease-[cubic-bezier(0.5,0,0.5,1)] pointer-events-none';

export function DesignCreationCard({ icon, title, actionLabel, onClick }: DesignCreationCardProps) {
  const posterPair = posterPairs[actionLabel];

  return (
    <div data-design-creation-card="" className="group relative flex min-h-[160px] w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-5 pb-0 text-left transition hover:border-white/40">
      {posterPair?.map((src, index) => (
        <img
          key={src}
          data-creation-card-poster={index === 0 ? 'first' : 'second'}
          src={src}
          alt=""
          aria-hidden="true"
          draggable={false}
          className={index === 0 ? firstPosterClass : secondPosterClass}
        />
      ))}
      <div data-creation-card-content="" className="opacity-100 transition-opacity duration-200 group-hover:opacity-0">
        <div data-creation-card-icon="">{icon}</div>
        <h2 data-creation-card-label="">{title}</h2>
      </div>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 translate-y-4 opacity-0 transition-all duration-200 ease-in-out group-hover:translate-y-0 group-hover:opacity-100">
        <button
          type="button"
          aria-label={actionLabel}
          className={`inline-flex h-8 ${actionButtonWidths[actionLabel] ?? ''} cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#0bc1b8] px-4 py-2 text-[12px] font-medium leading-[17.1429px] text-[#111817] shadow-[0_1px_2px_0_rgba(0,0,0,0.05)] transition-all hover:bg-[#20d0c4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70`}
          onClick={onClick}
        >
          <Plus aria-hidden="true" className="h-4 w-4 shrink-0" />
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
