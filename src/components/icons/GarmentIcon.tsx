// Line icons for the garment categories in the creator picker, so each category is recognisable at a glance.

const TEE = 'M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c0 1.7-1.8 3-4 3S8 4.7 8 3z';
const LONG_SLEEVE = 'M8 3 4 5 2 17h3l2-7v11h10V10l2 7h3L20 5l-4-2c0 1.7-1.8 3-4 3S8 4.7 8 3z';
const COAT = 'M8 3 4 5 2 17h3l2-7v12h10V10l2 7h3L20 5l-4-2';
const PANTS = 'M6 3h12l1 18h-5l-2-12-2 12H5z';
const DRESS = 'M9 2v4L7 9l1 2-4 11h16l-4-11 1-2-2-3V2';
const JUMPSUIT = 'M8 3 4 6l2 3 2-1v5l-1 9h4l1-7 1 7h4l-1-9V8l2 1 2-3-4-3c0 1.7-1.8 3-4 3S8 4.7 8 3z';

const shapes: Record<string, string[]> = {
  tee: [TEE],
  knit: [LONG_SLEEVE, 'M7 18h10', 'M9 18v3', 'M12 18v3', 'M15 18v3'],
  hoodie: [LONG_SLEEVE, 'M9 3.5c0 2.5 1.3 4.5 3 4.5s3-2 3-4.5', 'M9 15h6v3H9z'],
  shirt: [TEE, 'M9 3l3 4 3-4', 'M12 7v14'],
  tank: ['M8 2v2c0 2 1.8 3.5 4 3.5S16 6 16 4V2', 'M8 2c0 3-1.5 5-3 6v13h14V8c-1.5-1-3-3-3-6'],
  vest: ['M8 3 5 7v14h6V9', 'M16 3l3 4v14h-6V9', 'M8 3l4 6 4-6'],
  suit: [COAT, 'M8 3l4 8 4-8', 'M12 11v11', 'M14 15h.01', 'M14 18h.01'],
  blouson: [LONG_SLEEVE, 'M7 17h10', 'M12 6v11'],
  trench: [COAT, 'M8 3l4 5 4-5', 'M7 13h10', 'M10 8v14', 'M14 8v14'],
  overcoat: [COAT, 'M8 3l4 5 4-5', 'M12 8v14', 'M14 12h.01', 'M14 16h.01'],
  down: [LONG_SLEEVE, 'M7 10h10', 'M7 14h10', 'M7 18h10'],
  underwear: ['M4 8h16l-2 4c-2 2-4 3-6 7-2-4-4-5-6-7z'],
  swim: ['M8 2v5c-1 1-2 3-2 5l3 4-1 6h8l-1-6 3-4c0-2-1-4-2-5V2', 'M8 7c2 1.5 6 1.5 8 0'],
  roomwear: [LONG_SLEEVE, 'M9 4l3 4 3-4', 'M12 8v13'],
  roomBottoms: [PANTS, 'M6 6h12', 'M11 6l-1 3', 'M13 6l1 3'],
  pants: [PANTS, 'M6 6h12'],
  knitBottoms: [PANTS, 'M6 6h12', 'M8 3v3', 'M12 3v3', 'M16 3v3'],
  skirt: ['M7 4h10l3 16H4z', 'M7 7h10'],
  dress: [DRESS, 'M9 6h6'],
  woolDress: [DRESS, 'M9 6h6', 'M6 16h12', 'M5 19h14'],
  jumpsuit: [JUMPSUIT, 'M8 12h8'],
};

const byName: Record<string, string> = {
  ニット: 'knit', Tシャツ: 'tee', パーカー: 'hoodie', シャツ: 'shirt', タンクトップ: 'tank', ベスト: 'vest', スーツ: 'suit',
  ブルゾン: 'blouson', トレンチコート: 'trench', オーバーコート: 'overcoat', ダウン: 'down', 下着: 'underwear', スイムウェア: 'swim',
  ニットボトムス: 'knitBottoms', ハーフスカート: 'skirt', パンツ: 'pants', ウールワンピース: 'woolDress', ワンピース: 'dress', つなぎ: 'jumpsuit',
};

/** Picks the outline for a category; ルームウェア depends on the group it sits in. */
export function garmentIconKey(item: string, group: string) {
  if (item === 'ルームウェア') return group === 'ボトムス' ? 'roomBottoms' : group === 'トップス' ? 'roomwear' : 'jumpsuit';
  if (item === 'スイムウェア' && group === 'ボトムス') return 'underwear';
  return byName[item] ?? 'tee';
}

export function GarmentIcon({ item, group, className = '' }: { item: string; group: string; className?: string }) {
  const key = garmentIconKey(item, group);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" data-garment-icon={key} className={className}>
      {shapes[key].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
