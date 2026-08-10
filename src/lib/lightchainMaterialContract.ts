export type LightchainMaterialFeatureId =
  | 'fabric-image'
  | 'printing-image'
  | 'line-to-real'
  | 'line-generation';

export type LightchainMaterialInputSlot = {
  id: string;
  label: string;
  required: boolean;
  acceptedKinds: string[];
  description: string;
};

export type LightchainMaterialTab = {
  id: LightchainMaterialFeatureId;
  label: string;
  route: string;
  description: string;
};

/**
 * The material/print tools share one Light Chain interaction contract.
 * Keep this data-driven so a new route cannot silently drift into a
 * different input order or output handoff.
 */
export const LIGHTCHAIN_MATERIAL_TABS: LightchainMaterialTab[] = [
  {
    id: 'fabric-image',
    label: '生地イメージ',
    route: '/lightchain/fabric-image',
    description: '異なる生地の質感を商品画像で確認します。',
  },
  {
    id: 'printing-image',
    label: 'プリントイメージ',
    route: '/lightchain/printing-image',
    description: 'スポット／全体のプリント効果を確認します。',
  },
  {
    id: 'line-to-real',
    label: '線画の実写化',
    route: '/lightchain/line-to-real',
    description: '線画を平置き・実写候補へ展開します。',
  },
  {
    id: 'line-generation',
    label: '平絵生成',
    route: '/lightchain/line-generation',
    description: '着用画像や平置き画像から線画を作ります。',
  },
];

export const LIGHTCHAIN_MATERIAL_INPUTS: Record<
  Extract<LightchainMaterialFeatureId, 'fabric-image' | 'printing-image'>,
  LightchainMaterialInputSlot[]
> = {
  'fabric-image': [
    {
      id: 'model-design',
      label: 'モデル／デザイン画像',
      required: true,
      acceptedKinds: ['base', 'pattern'],
      description: '商品・モデル・デザインの基準画像です。',
    },
    {
      id: 'fabric',
      label: '生地画像',
      required: true,
      acceptedKinds: ['base', 'texture'],
      description: '質感を反映する生地の参照画像です。',
    },
  ],
  'printing-image': [
    {
      id: 'garment',
      label: '参考画像',
      required: true,
      acceptedKinds: ['base'],
      description: 'プリントを載せる服・商品画像です。',
    },
    {
      id: 'print',
      label: 'プリント画像',
      required: true,
      acceptedKinds: ['pattern'],
      description: 'スポット／全体へ配置する柄・ロゴ画像です。',
    },
  ],
};

export const LIGHTCHAIN_MATERIAL_LIBRARY_TABS = [
  { id: 'upload-history', label: '履歴アップロード' },
  { id: 'generation-history', label: '生成履歴' },
  { id: 'my-library', label: 'マイライブラリー' },
  { id: 'team-library', label: 'チームライブラリー' },
  { id: 'platform-assets', label: 'プラットフォームアセット' },
] as const;

export type LightchainMaterialLibraryTabId =
  typeof LIGHTCHAIN_MATERIAL_LIBRARY_TABS[number]['id'];

export const getLightchainMaterialTab = (id: LightchainMaterialFeatureId) =>
  LIGHTCHAIN_MATERIAL_TABS.find((tab) => tab.id === id) ?? LIGHTCHAIN_MATERIAL_TABS[0];
