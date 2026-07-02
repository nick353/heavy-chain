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
const nav = read('src/components/layout/navigation.ts');
const materialWorkbench = read('src/components/workspace/MaterialWorkbench.tsx');
const gallery = read('src/pages/GalleryPage.tsx');
const onboarding = read('src/components/Onboarding.tsx');

const userFacingBundle = [
  ['DashboardPage.tsx', dashboard],
  ['GeneratePage.tsx', generate],
  ['LightchainWorkbenchPage.tsx', lightchain],
  ['App.tsx', app],
  ['FeedbackForm.tsx', feedback],
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

addCheck('dashboard_has_three_internal_beta_start_ctas', (
  dashboard.includes('まず1つ作る')
  && dashboard.includes('商品画像から作る')
  && dashboard.includes('SNS/EC画像を探す')
  && dashboard.includes('Canvasで編集する')
  && dashboard.includes('dashboard-internal-beta-start')
), {});

addCheck('generate_primary_action_is_provider_neutral', (
  generate.includes("noImageGenerationMode ? '生成する'")
  && !generate.includes('Runway workerで生成')
  && !generate.includes('Geminiで生成')
), {});

addCheck('lightchain_surface_uses_material_workbench_language', (
  lightchain.includes('素材ワークベンチ')
  && lightchain.includes('素材を入れる')
  && lightchain.includes('調整する')
  && lightchain.includes('Canvasへ保存')
), {});

addCheck('feedback_collects_internal_beta_friction_categories', (
  feedback.includes('どこを押すかわからない')
  && feedback.includes('生成結果が微妙')
  && feedback.includes('保存先がわからない')
  && feedback.includes('動作が遅い')
  && feedback.includes('社内beta')
), {});

addCheck('navigation_uses_material_workbench_label', (
  nav.includes("label: '素材ワークベンチ'")
  && nav.includes("mobileLabel: '素材'")
  && !nav.includes("label: 'Lightchain互換'")
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
