import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('design cards rename in place like Light (click the title, Enter or click away saves the library title)', () => {
  const page = read('src/pages/LightchainParityPages.tsx');
  assert.match(page, /data-testid="design-card-rename-input"/);
  assert.match(page, /updateGeneratedImageLibraryTitle\(remoteImageId, title, context\)/);
  assert.match(page, /metadata\.libraryTitle, metadata\.title/);
  // The title sits in a div (not a button) so a text field can replace it.
  assert.match(page, /role="button"\n        tabIndex=\{href \? 0 : -1\}/);
});

test('the design list signs only what it needs before showing the grid', () => {
  const page = read('src/pages/LightchainParityPages.tsx');
  assert.match(page, /\.filter\(\(row\) => designHistoryFeatureTypes\.has\(row\.feature_type \?\? 'generate-image'\)\)/);
  assert.match(page, /withSignedImageUrls\(rows\.slice\(0, DESIGN_REFERENCE_SIGN_LIMIT\)\)/);
});

test('marketing home matches Light\'s re-measured title and chips', () => {
  const page = read('src/pages/LightchainParityPages.tsx');
  assert.match(page, /pt-\[89px\]/);
  assert.match(page, /text-\[36px\] font-medium leading-10">マーケティングワークスペースへようこそ/);
  assert.match(page, /text-sm font-medium leading-5 text-white">\{sceneCard\.label\}/);
});

test('library groups nest inside a 汎用 group like Light', () => {
  const library = read('src/pages/LightchainLibraryPage.tsx');
  assert.match(library, /parentId: row\.parent_folder_id \?\? null/);
  assert.match(library, /createFolder\(\{ id, brand_id: brandId, name, parent_folder_id: newGroupParent \}\)/);
  assert.match(library, /data-testid="library-new-child-group"/);
  assert.match(library, /data-testid="library-child-group"/);
  assert.match(library, /renderChildGroups\(group\.id, 1\)/);
});

test('marketing project cards match Light: checkbox, bulk delete, rename in place, ··· menu', () => {
  const page = read('src/pages/LightchainParityPages.tsx');
  assert.match(page, /data-testid="marketing-project-select"/);
  assert.match(page, /data-testid="marketing-project-selection-bar"/);
  assert.match(page, /data-testid="marketing-card-rename-input"/);
  assert.match(page, /onClick=\{\(\) => void saveProjectToLibrary\(entry\)\}><Bookmark className="h-4 w-4" \/>アセットライブラリに保存/);
  assert.match(page, /<h2 className="mb-4 text-lg font-normal leading-7">\{openGroup[\s\S]*?: 'マイプロジェクト'\}<\/h2>/);
});

test('fashion studio list and detail match Light\'s layout', () => {
  const css = read('src/index.css');
  assert.match(css, /div:first-child h1 \{ height: 25px; margin: 0; color: #fff; font-size: 16px; font-weight: 500; line-height: 25px; \}/);
  assert.match(css, /section > div:nth-child\(2\) \{ display: flex; width: 100%; flex-wrap: wrap; gap: 8px; margin-top: 16px; \}/);
  assert.match(css, /\.fashion-studio-source-task \{\n  bottom: 40px;\n  left: 16px;/);
  const detail = read('src/pages/FashionStudioDetailPage.tsx');
  assert.match(detail, /aria-label="キャンバスを整理"/);
  assert.match(detail, /data-testid="fashion-studio-reference-count"/);
  assert.match(detail, />生成設定</);
});

test('custom style matches Light\'s 16px titles and 5:6 cards', () => {
  const page = read('src/pages/LightchainCustomStylePage.tsx');
  assert.match(page, /text-base font-medium leading-4 text-white">ラーニング素材をアップロードしてください/);
  assert.match(page, /text-base font-medium leading-10 text-white">カスタムスタイルライブラリ/);
  assert.match(page, /aspect-\[5\/6\]/);
});

test('業務プリファレンスプロファイル is its own page with Light\'s list and form', () => {
  const app = read('src/App.tsx');
  for (const path of ['/agent/profiles', '/agent/profiles/create', '/agent/profiles/:profileId']) assert.ok(app.includes(`path="${path}"`), path);
  assert.ok(app.indexOf('path="/agent/profiles"') < app.indexOf('path="/agent/:taskId"'));
  const page = read('src/pages/AgentProfilesPage.tsx');
  for (const text of ['業務プリファレンスプロファイルはまだありません', 'プロファイル名と内容を検索', '業務範囲', '件の必須項目', 'プロファイルを保存', 'チャネル名を入力し、Enterで確定', '希望する色、シルエット、素材、ディテール、モデル、構図、避けたい表現を入力してください']) assert.ok(page.includes(text), text);
  const tasks = read('src/features/agent/agentTasks.ts');
  assert.match(tasks, /AGENT_PROFILE_COUNTRIES = \['中国', '日本', '北米', 'ヨーロッパ', 'アフリカ'\]/);
  assert.match(tasks, /AGENT_PROFILE_AGES = \['0〜18歳', '19〜24歳', '25〜34歳', '35〜44歳', '45〜65歳'\]/);
  const sidebar = read('src/features/agent/AgentSidebar.tsx');
  assert.match(sidebar, /onClick=\{\(\) => navigate\('\/agent\/profiles'\)\}/);
});

test('editor lists and planning tasks match Light', () => {
  const css = read('src/index.css');
  assert.match(css, /\.pattern-project-dashboard-new-label \{ color: #abb8b6; font-size: 14px; line-height: 21px; \}/);
  assert.match(css, /\.pattern-project-dashboard-name \{[^}]*font-size: 14px;/);
  const sidebar = read('src/features/agent/AgentSidebar.tsx');
  assert.match(sidebar, /aria-label="更に見る"/);
  assert.match(sidebar, />名前を変更<\/button>/);
  assert.match(sidebar, /deleteAgentTask\(task\.id\)/);
  const task = read('src/pages/HeavyAgentTaskPage.tsx');
  assert.match(task, /max-w-\[752px\]/);
  assert.match(task, /rounded-2xl border border-white\/10 bg-\[#262a2b\] p-4 text-sm text-neutral-300/);
});

test('design projects can be moved into groups like Light (移動 / 新規グループ作成)', () => {
  const dialogs = read('src/components/lightchain/ProjectGroupDialogs.tsx');
  for (const text of ['移動', 'ルートフォルダー', '利用可能な移動先グループがありません', '新規グループ作成', 'グループ名を入力', 'グループのカバー画像 *', '画像をアップロード']) assert.ok(dialogs.includes(text), text);
  const page = read('src/pages/LightchainParityPages.tsx');
  assert.match(page, /onClick=\{onMove\}><ArrowRight className="h-4 w-4" \/>移動<\/button>/);
  assert.match(page, /data-testid="design-project-groups"/);
  assert.match(page, /groupState\.members\[gridItemId\(item\)\] === openGroup\.id/);
});

test('marketing projects can be moved into their own groups like Light (移動)', () => {
  const page = read('src/pages/LightchainParityPages.tsx');
  assert.match(page, /setMovingProjectId\(entry\.projectId\); setOpenProjectMenuId\(null\); \}\}><ArrowRight className="h-4 w-4" \/>移動<\/button>/);
  assert.match(page, /data-testid="marketing-project-groups"/);
  assert.match(page, /groupState\.members\[entry\.projectId\] === openGroupId/);
  assert.match(page, /readDesignProjectGroups\(userId, brandId, 'marketing'\)/);
  const groups = read('src/lib/designProjectGroups.ts');
  assert.match(groups, /heavy-\$\{workspace\}-project-groups:v1:/);
});
