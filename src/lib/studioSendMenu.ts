import { INCOMING_IMAGE_PARAM } from './incomingImage.ts';

export type StudioSendTarget = { label: string; path: string };
export type StudioSendGroup = { label: string; items: readonly StudioSendTarget[] };

/**
 * スタジオの帯の「送る」の行き先。本家（34vt0w060bmsy.js の 2271）は左の機能の束（TabList）から
 * AIAgent と aiDesign を除いた3つの束をそのまま小メニューにする。並びと名前は本家の日本語のまま、
 * 道は Heavy の道（App.tsx。本家と同じ道で開く）。Lightchain Lab は Heavy の名前「Heavy Chain Lab」。
 */
export const STUDIO_SEND_GROUPS: readonly StudioSendGroup[] = Object.freeze([
  {
    label: '企画デザインツール',
    items: Object.freeze([
      { label: 'デザインワークスペース', path: '/designProduction/detail' },
      { label: 'ウェアデザインラボ', path: '/flow/orientedDesign/detail' },
      { label: '生地プリントの試着シミュレーション', path: '/tools/fabric' },
      { label: '線画から実写へ変換', path: '/tools/line-draft-to-tile' },
      { label: '色変更', path: '/editor/changeColor/detail' },
      { label: '平絵をベクター化', path: '/tools/svg-convert' },
      { label: 'カスタムスタイル', path: '/model-base/style' },
    ]),
  },
  {
    label: 'AIフィッティング',
    items: Object.freeze([
      { label: 'AIフィッティング', path: '/model' },
      { label: 'モデル企画ライブラリ', path: '/model-library/model-custom-form' },
      { label: 'ファッションスタジオ', path: '/flow/integration/detail' },
      { label: '動画ワークステーション', path: '/flow/GenerateShortVideo/detail' },
      { label: 'Heavy Chain Lab', path: '/flow/laboratory/detail' },
      { label: '画像修正', path: '/tools/reactor' },
    ]),
  },
  {
    label: 'グラフィックツール',
    items: Object.freeze([
      { label: 'デザインワークスペース', path: '/designProduction/detail' },
      { label: 'プリントデザイン', path: '/editor/patternDesign/detail' },
      { label: 'パターンをベクター画像に変換（プロフェッショナル版）', path: '/tools/vector-special' },
      { label: 'デザインアレンジ', path: '/editor/pattern/detail' },
    ]),
  },
]);

/** 本家と同じ `<行き先>?imgUrl=<画像の住所>`（qs.stringify と同じく encodeURIComponent）。 */
export function studioSendHref(path: string, imageUrl: string): string {
  return `${path}?${INCOMING_IMAGE_PARAM}=${encodeURIComponent(imageUrl)}`;
}
