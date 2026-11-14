import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setOpenverseRelay } from './features/designDetail/referenceImageSearch.ts'
import { openverseRelayRequest } from './lib/cloudflareApi.ts'

// 参考画像の Openverse 検索は、鍵を持つ自分のサーバー経由にする（鍵が無ければ中継が null を返し、今までどおり
// ブラウザから鍵なしで直接呼ぶ）。登録はここだけ: 検索を呼ぶ画面はどれも変えていない。
setOpenverseRelay(openverseRelayRequest)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
