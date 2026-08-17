# Lightchain権限制限とHeavy Chain自前フォールバック

更新日: 2026-08-16

## 方針

Lightchainの「権限がありません」はプラン規制の表示としてそのまま扱う。Lightchain側の制限を迂回したり、LightchainのAPIを代行実行したりしない。Heavy Chainでは同じUI上の状態から、Heavyが所有する実行可能な`model-matrix`導線へ明示的に切り替える。

Heavyの実行経路は次の境界を持つ。

1. Lightchain parity画面で設定（タスク種別、説明生成タブ、Smart/1K、正面、自然光、自動平置き）を収集する。
2. `Heavy Chainで続ける`でHeavyのFittingへ渡す。
3. 既存Gallery素材を選び、Heavy側の高精度切り抜きで確認する。
4. 権利確認、生成条件、パターン数のゲートを通したうえで、既存のHeavy `model-matrix` Edge Functionへ送る。
5. 成果物は`generated_images`、History、Jobs、Gallery、Canvas、Downloadの既存境界でreadbackする。

## 採用・保留する技術

| 役割 | 採用方針 | ライセンス・判断 |
| --- | --- | --- |
| 服画像の前処理 | 既存のHeavyブラウザ実装でMODNet/BEN2を選択可能にする | MODNet WebNNはApache-2.0、BEN2-ONNXはMIT。商用組み込み候補 |
| 将来の精密マスク | サーバーGPUを用意できた場合だけSAM2アダプタを追加 | SAM2はApache-2.0。現行のブラウザ実行には無理に搭載しない |
| 将来の高解像度化 | 結果の品質要件が確定した場合だけReal-ESRGANアダプタを追加 | BSD-3-Clause。生成後処理として分離 |
| 着用生成 | Heavy既存のOpenAI `model-matrix` APIを使用 | APIキーと課金境界をHeavy側で管理 |
| CatVTON / IDM-VTON | 本番には組み込まない | いずれもCC BY-NC-SA-4.0系の非商用条件があるため、商用Heavyの代替実装には不採用 |
| FLUX.1-schnell | 現行経路には追加しない | Apache-2.0だが大きなGPUモデルで、現在のHeavy API境界に対する費用・運用効果が未確認 |

## 参照元

- [MODNet WebNN model card](https://huggingface.co/onnx-community/modnet-webnn)
- [BEN2-ONNX model card](https://huggingface.co/onnx-community/BEN2-ONNX)
- [SAM2 official repository](https://github.com/facebookresearch/sam2)
- [Real-ESRGAN official repository](https://github.com/xinntao/Real-ESRGAN)
- [CatVTON model card](https://huggingface.co/zhengchong/CatVTON)
- [IDM-VTON model card](https://huggingface.co/yisol/IDM-VTON)
- [FLUX.1-schnell model card](https://huggingface.co/black-forest-labs/FLUX.1-schnell)

## 未実装の保留事項

- Heavyが独自に着用生成モデルをホストする場合のGPU、モデル重み、ライセンス表記、削除要求、コスト上限は未確定。
- MODNet/BEN2/SAM2/Real-ESRGANのモデル更新は、ハッシュ固定・性能比較・同意済みデータでの回帰評価を通過してから行う。
- Lightchainのプラン権限をHeavyの利用権限へ自動変換しない。Heavy側の契約・クレジット・権利確認は独立して判定する。
