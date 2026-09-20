import { useNavigate } from 'react-router-dom';

type VideoProject = {
  id: string;
  title: string;
  age: string;
  imageUrl?: string;
  reference?: boolean;
};

const LIGHTCHAIN_VIDEO_SNAPSHOT_ORIGIN = 'https://static-jp.linkaigc.com/saas';
const LIGHTCHAIN_TEST_VIDEO_SNAPSHOT_ORIGIN = 'https://lightchain-qlxy-test.oss-cn-hangzhou.aliyuncs.com/saas';
const PROJECT_DEFAULT_COVER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJAAAACQCAYAAADnRuK4AAAACXBIWXMAACE4AAAhOAFFljFgAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAOdEVYdFNvZnR3YXJlAEZpZ21hnrGWYwAAA4hJREFUeAHt3YtR20AQgOFVJgWQDpQKQgmiAkgFmApCB4gOQgVxKggdIDqgA+ggpILLLTIz8ll+nnxaTv8347FPzCA4L3u7kiVEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAclCIYc65yj+VMl1NURQvYpjZAPLBc+Gf/gjOfBA1YtQnseuHQN2IYSYzkM8+pX96Frz74rPQqxj0WWyqg/GtfzQyHbp8dzPwtazOCfpo9nHLJpeJ/O984h9/O3Ogr0/EIIs1UBWMG5mYxXL1u7NJg2cm2E4zTpCBSpkgPYQRzMODYDM/SbNg0n7JhGnQBPNRCdZjwpaRhfZA8dwvKKadtWLaUhFdbxlP1V0wvhYsI/us54y39FYyUBWMG8EbWvodOFr3jSimN3C07juhQ12DidkNWagHxfN+nMGWfuwiut4yxjJa+ndkn/05gy39mBmoCsaNYCNa+g5H634QimmhdY81+c518hMQadJZiOJ5GM5ISz9GEV1vGWM3Jlr6pJf1uP7LdRoZ1p3vVu7FGNdeKHkpbec0BP0+p52xdmhfrV7+M4ie4vkYzF3B4FaX7WOZSWKpl7BSjs/isZELSaOUxCxf2hzjXGyx9vMMZuwA0jV7ELJcS1VWljHX1n1VZ1NTDMR/r68yspwy0GMwTrVsbFMF47lkJKcAmgfjS7EhvLvGo2QkmwAq2hsxNZ1NuoyN+nEHv38NnrKzyfwNo/aVWxF9G4xv/Jt4KiPw+9UMWAebbyUzWQVQ0d7Jq+ls0kL6IXUm8vvTW7PMg83zwvCdxj4EP7F1cOCrlIG59kNXzz0H2TSQKjki157kfOjZ9/MxukK3eoCylsSs3mDqYP6v/NVP5Jl/qWeoy86XKmnrIj3U/yTDOlnsqy9IXqS9z2GWpxiyCyClheoiiGpZ7cb0Ta4kDT0nd5Vr8Khcj0S/BZF/zPzLK2mzQEqa4TTrfM85eFSWGajLv4Fz/zRf1D8z//gm65ebQ2mQvEh7jOd+SsVy9gH0rqdDwwCyXcKQBgGEKAQQohBAiEIAIQoBhCgEEKIQQIhCACEKAYQoBBCiEECIQgAhythn48+dc/8Ehxr94smxA+in4ENjCUOU1AHUCI5FPxU5l8SS/9/4xaU8pWBoT7l//hoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4WP4DYM4Bam9EvcoAAAAASUVORK5CYII=';
const PROJECT_NEW_FILE_ICON = 'data:image/png;base64,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';

const projects: VideoProject[] = [
  { id: 'untitled-3m', title: 'Untitled', age: '3ヶ月前' },
  { id: 'untitled-4m-1', title: 'Untitled', age: '4ヶ月前', imageUrl: `${LIGHTCHAIN_VIDEO_SNAPSHOT_ORIGIN}/2026-02/548083b211dccf02c2b0335279d15216.mp4?x-oss-process=video/snapshot,t_1000,m_fast,ar_auto` },
  { id: 'untitled-4m-2', title: 'Untitled', age: '4ヶ月前', imageUrl: `${LIGHTCHAIN_VIDEO_SNAPSHOT_ORIGIN}/2026-04/b9e909c9d8444f93918a34724c255adb.mp4?x-oss-process=video/snapshot,t_1000,m_fast,ar_auto` },
  { id: 'untitled-4m-3', title: 'Untitled', age: '4ヶ月前', imageUrl: `${LIGHTCHAIN_VIDEO_SNAPSHOT_ORIGIN}/2026-04/509cc48a248ff6fbcc0492b57f6aac68.mp4?x-oss-process=video/snapshot,t_1000,m_fast,ar_auto` },
  { id: 'untitled-7m-1', title: 'Untitled', age: '7ヶ月前', imageUrl: `${LIGHTCHAIN_VIDEO_SNAPSHOT_ORIGIN}/2026-02/1e4238ea72d473c5d39be73e58e3ea05.mp4?x-oss-process=video/snapshot,t_1000,m_fast,ar_auto` },
  { id: 'untitled-7m-2', title: 'Untitled', age: '7ヶ月前', imageUrl: `${LIGHTCHAIN_TEST_VIDEO_SNAPSHOT_ORIGIN}/2026-01/be85465f39e4bf553c55e59f521b047a.mp4?x-oss-process=video/snapshot,t_1000,m_fast,ar_auto` },
  { id: 'storyboard-copy', title: 'ストーリーボード作成と映像複製', age: '8ヶ月前', imageUrl: `${LIGHTCHAIN_TEST_VIDEO_SNAPSHOT_ORIGIN}/2026-01/b2bc805754975f48fe8aac9e9cd6d001.mp4?x-oss-process=video/snapshot,t_1000,m_fast,ar_auto`, reference: true },
  { id: 'ec-model', title: 'ECモデルの展示のレプリカ', age: '8ヶ月前', imageUrl: `${LIGHTCHAIN_TEST_VIDEO_SNAPSHOT_ORIGIN}/2026-01/be85465f39e4bf553c55e59f521b047a.mp4?x-oss-process=video/snapshot,t_1000,m_fast,ar_auto`, reference: true },
  { id: 'minimal-lookbook', title: 'ミニマルなルックブック動画', age: '8ヶ月前', imageUrl: `${LIGHTCHAIN_TEST_VIDEO_SNAPSHOT_ORIGIN}/2026-01/ed31223882b364815833e87870dcfc0c.mp4?x-oss-process=video/snapshot,t_1000,m_fast,ar_auto`, reference: true },
  { id: 'clothing-replace', title: '動画生成 + 服の置き換え', age: '8ヶ月前', imageUrl: `${LIGHTCHAIN_TEST_VIDEO_SNAPSHOT_ORIGIN}/2026-01/231d312fb11efd1028aff7b6cd59f1e3.mp4?x-oss-process=video/snapshot,t_1000,m_fast,ar_auto`, reference: true },
  { id: 'short-film-recovery', title: 'ファッションショートフィルムの復元', age: '8ヶ月前', imageUrl: `${LIGHTCHAIN_TEST_VIDEO_SNAPSHOT_ORIGIN}/2026-01/6dbc3e2e853d0fb7da9b24a0c0627a1c.mp4?x-oss-process=video/snapshot,t_1000,m_fast,ar_auto`, reference: true },
];

export function VideoProjectDashboardPage() {
  const navigate = useNavigate();

  const openDetail = (project: VideoProject) => {
    navigate(`/flow/GenerateShortVideo/detail?project=${encodeURIComponent(project.id)}`);
  };

  return (
    <main
      className="dark min-h-[calc(100vh-50px)] bg-[#171b1c] px-4 pb-8 pt-3 text-white"
      data-testid="lightchain-video-project-dashboard"
      data-lightchain-provider-rights="internal-only"
    >
      <section className="w-full">
        <h1 className="text-base font-semibold leading-6">動画ワークステーション</h1>

        <section className="mt-4" aria-label="マイプロジェクト">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-[repeat(7,220px)]">
            <button
              type="button"
              onClick={() => navigate('/flow/GenerateShortVideo/detail?project=new')}
              aria-label="新規ファイル"
              className="group flex h-[240px] w-full flex-col items-center justify-center overflow-hidden rounded-2xl bg-[#25292c] text-left transition hover:bg-[#2d3235] lg:w-[220px]"
            >
              <img src={PROJECT_NEW_FILE_ICON} alt="project" className="size-20 object-contain" />
              <span className="mt-5 text-sm font-medium text-neutral-200">新規ファイル</span>
            </button>

            <div data-testid="video-recent-projects" className="contents">
              {projects.filter((project) => !project.reference).map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => openDetail(project)}
                className="group flex h-[240px] w-full flex-col overflow-hidden rounded-2xl bg-[#25292c] text-left transition hover:bg-[#2d3235] lg:w-[220px]"
              >
                <div className={`flex h-[170px] shrink-0 justify-center overflow-hidden bg-[#25292c] ${project.imageUrl ? 'items-start' : 'items-center'}`}>
                  {project.imageUrl ? (
                    <img src={project.imageUrl} alt="coverImg" className="object-cover" loading="eager" />
                  ) : (
                    <img src={PROJECT_DEFAULT_COVER} alt="coverImg" className="size-12 object-contain" />
                  )}
                </div>
                <div className="flex min-h-0 flex-1 items-start justify-between gap-2 px-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-200">{project.title}</p>
                    <p className="mt-1 truncate text-xs text-neutral-400">{project.age} <span data-testid="video-project-edit-label">修正</span></p>
                  </div>
                </div>
              </button>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-5" aria-labelledby="video-reference-heading">
          <h2 id="video-reference-heading" className="text-base font-semibold leading-6">参考事例</h2>
          <div className="mt-[14px] grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-[repeat(5,220px)]">
            {projects.filter((project) => project.reference).map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => openDetail(project)}
                className="group flex h-[240px] w-full flex-col overflow-hidden rounded-2xl bg-[#25292c] text-left transition hover:bg-[#2d3235] lg:w-[220px]"
              >
                <div className="h-[168px] shrink-0 overflow-hidden bg-[#25292c]">
                  {project.imageUrl && <img src={project.imageUrl} alt="coverImg" className="object-cover" loading="eager" />}
                </div>
                <div className="flex min-h-0 flex-1 items-start justify-between gap-2 px-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-200">{project.title}</p>
                    <p className="mt-1 truncate text-xs text-neutral-400">{project.age} <span data-testid="video-project-edit-label">修正</span></p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
