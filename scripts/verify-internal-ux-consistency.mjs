#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const outDir = args.out || `output/playwright/internal-ux-consistency-${dateStamp()}`;
fs.mkdirSync(outDir, { recursive: true });

const checks = [];
const read = (file) => fs.readFileSync(file, 'utf8');
const addCheck = (id, ok, details = {}) => checks.push({ id, ok: Boolean(ok), details });

const dashboard = read('src/pages/DashboardPage.tsx');
const generate = read('src/pages/GeneratePage.tsx');
const lightchain = read('src/pages/LightchainWorkbenchPage.tsx');
const app = read('src/App.tsx');
const feedback = read('src/components/ui/FeedbackForm.tsx');
const admin = read('src/pages/AdminDashboard.tsx');
const nav = read('src/components/layout/navigation.ts');
const materialWorkbench = read('src/components/workspace/MaterialWorkbench.tsx');
const gallery = read('src/pages/GalleryPage.tsx');
const onboarding = read('src/components/Onboarding.tsx');
const packageJson = read('package.json');
const submitFeedback = read('supabase/functions/submit-feedback/index.ts');

const userFacingBundle = [
  ['DashboardPage.tsx', dashboard],
  ['GeneratePage.tsx', generate],
  ['LightchainWorkbenchPage.tsx', lightchain],
  ['App.tsx', app],
  ['FeedbackForm.tsx', feedback],
  ['AdminDashboard.tsx', admin],
  ['navigation.ts', nav],
  ['MaterialWorkbench.tsx', materialWorkbench],
  ['GalleryPage.tsx', gallery],
  ['Onboarding.tsx', onboarding],
];

for (const [label, source] of userFacingBundle) {
  addCheck(`no_legacy_primary_cta:${label}`, !/(Geminiで生成|Runway workerで生成|Untitled|未読込|画像なし)/.test(source), {
    label,
    matches: [...source.matchAll(/Geminiで生成|Runway workerで生成|Untitled|未読込|画像なし/g)].map((match) => match[0]),
  });
}

addCheck('dashboard_uses_category_workflow_entry_without_quick_start_noise', (
  dashboard.includes('<LightchainParityHub compactOnMobile />')
  && !dashboard.includes('まず1つ作る')
  && !dashboard.includes('商品画像から作る')
  && !dashboard.includes('SNS/EC画像を探す')
  && !dashboard.includes('Canvasで編集する')
), {});

addCheck('generate_primary_action_is_provider_neutral', (
  generate.includes("noImageGenerationMode ? '生成する'")
  && !generate.includes('Runway workerで生成')
  && !generate.includes('Geminiで生成')
), {});

addCheck('lightchain_surface_uses_material_workbench_language', (
  lightchain.includes('素材作業台')
  && lightchain.includes('素材を入れる')
  && lightchain.includes('調整する')
  && lightchain.includes('Canvasへ保存')
), {});

addCheck('feedback_collects_screenshot_and_comment_only', (
  feedback.includes('画面スクショ')
  && feedback.includes('コメント')
  && feedback.includes("const type: FeedbackType = 'other'")
  && feedback.includes('placeholder="気づいたことをそのまま書いてください"')
  && feedback.includes('setIsOpen(true)')
  && !feedback.includes('困ったこと')
  && !feedback.includes('どこを押すかわからない')
  && !feedback.includes('切り抜きがうまくいかない')
  && !feedback.includes('動作が遅い')
  && !feedback.includes('メールアドレス（任意）')
  && !feedback.includes('返信をご希望の場合')
  && !feedback.includes('import { Button, Textarea, Input }')
), {});

addCheck('feedback_collects_screenshot_and_context', (
  packageJson.includes('"html2canvas"')
  && feedback.includes("import html2canvas from 'html2canvas'")
  && feedback.includes("supabase.functions.invoke('submit-feedback'")
  && feedback.includes('screenshot_capture_status')
  && feedback.includes('MAX_SCREENSHOT_DATA_URL_LENGTH')
  && feedback.includes('height: window.innerHeight')
  && feedback.includes('page_url: window.location.href')
  && feedback.includes('user_agent: window.navigator.userAgent')
  && feedback.includes('再撮影')
  && submitFeedback.includes("FEEDBACK_SCREENSHOT_BUCKET = 'feedback-screenshots'")
  && submitFeedback.includes(".from('feedback_submissions')")
  && submitFeedback.includes('.remove([uploadedScreenshotPath])')
  && submitFeedback.includes('MAX_SCREENSHOT_BYTES')
  && submitFeedback.includes('MAX_REQUEST_BYTES')
  && submitFeedback.includes('content-length')
  && submitFeedback.includes('readJsonWithLimit')
  && submitFeedback.includes('normalizePageUrl')
), {});

addCheck('admin_dashboard_reviews_beta_feedback', (
  admin.includes("{ id: 'feedback', label: 'フィードバック' }")
  && admin.includes("from('feedback_submissions')")
  && admin.includes("from('feedback-screenshots')")
  && admin.includes('getSafeFeedbackUrl')
  && admin.includes('FEEDBACK_STATUS_LABELS')
  && admin.includes('管理メモ')
  && admin.includes('未対応')
  && admin.includes('対応中')
  && admin.includes('完了')
), {});

addCheck('navigation_uses_material_workbench_label', (
  nav.includes("label: '素材作業台'")
  && nav.includes("mobileLabel: '素材'")
  && !nav.includes("label: 'Heavy Chain互換'")
), {});

const summary = {
  schema: 'heavy-chain.internal-ux-consistency.v1',
  capturedAt: new Date().toISOString(),
  checks,
  failed: checks.filter((check) => !check.ok).map((check) => check.id),
};
summary.ok = summary.failed.length === 0;

const summaryPath = path.join(outDir, 'summary.json');
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ok: summary.ok, failed: summary.failed, summary: summaryPath }, null, 2));
process.exit(summary.ok ? 0 : 1);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function dateStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
