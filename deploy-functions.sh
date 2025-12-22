#!/bin/bash

# 🚀 Heavy Chain - 残り4個のEdge Functionsをデプロイ
# このスクリプトを実行して、すべての機能を有効化します

set -e  # エラーが発生したら停止

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Heavy Chain - Edge Functions デプロイ"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# カレントディレクトリを確認
if [ ! -d "supabase/functions" ]; then
    echo "❌ エラー: supabase/functions ディレクトリが見つかりません"
    echo "   プロジェクトのルートディレクトリで実行してください"
    exit 1
fi

# Supabase Project Reference IDを入力
echo "📝 Supabase Project Reference IDを入力してください"
echo ""
echo "取得方法:"
echo "  1. https://app.supabase.com/ を開く"
echo "  2. プロジェクトを選択"
echo "  3. Settings (⚙️) → General"
echo "  4. Reference ID をコピー"
echo ""
echo "または、URLから確認:"
echo "  URL: https://app.supabase.com/project/ulfbddqwumeoqidxatyq/..."
echo "  この場合、Reference IDは 'ulfbddqwumeoqidxatyq'"
echo ""
read -p "Project Reference ID: " PROJECT_REF

if [ -z "$PROJECT_REF" ]; then
    echo "❌ エラー: Project Reference IDが入力されていません"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 ステップ 1/4: Supabaseにログイン"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ログイン状態を確認
if supabase projects list &>/dev/null; then
    echo "✅ すでにログイン済みです"
else
    echo "ブラウザでログインしてください..."
    supabase login
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔗 ステップ 2/4: プロジェクトにリンク"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

supabase link --project-ref "$PROJECT_REF"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 ステップ 3/4: Edge Functionsをデプロイ"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd supabase/functions

FUNCTIONS=("colorize" "remove-background" "share-link" "bulk-download")
DEPLOYED=0
FAILED=0

for func in "${FUNCTIONS[@]}"; do
    echo "📦 デプロイ中: $func"
    if supabase functions deploy "$func"; then
        echo "✅ $func - デプロイ成功"
        ((DEPLOYED++))
    else
        echo "❌ $func - デプロイ失敗"
        ((FAILED++))
    fi
    echo ""
done

cd ../..

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ ステップ 4/4: デプロイ結果を確認"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "📊 デプロイ結果:"
echo "  ✅ 成功: $DEPLOYED 個"
echo "  ❌ 失敗: $FAILED 個"
echo ""

echo "📋 全Edge Functions一覧:"
supabase functions list

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 デプロイ完了！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $FAILED -eq 0 ]; then
    echo "✅ すべてのEdge Functionsのデプロイに成功しました！"
    echo ""
    echo "🎯 次のステップ:"
    echo "  1. Supabase Dashboard → Settings → Edge Functions → Environment Variables"
    echo "  2. GEMINI_IMAGE_MODEL を設定（まだの場合）"
    echo "     Name:  GEMINI_IMAGE_MODEL"
    echo "     Value: imagen-3.0-generate-001"
    echo "  3. https://heavy-chain.zeabur.app で画像生成をテスト"
    echo ""
    echo "🚀 すべての機能が使えます！"
else
    echo "⚠️  一部のデプロイに失敗しました"
    echo ""
    echo "トラブルシューティング:"
    echo "  - エラーメッセージを確認してください"
    echo "  - 必要に応じて、失敗した関数を個別にデプロイしてください:"
    echo "    cd supabase/functions"
    echo "    supabase functions deploy <function-name>"
fi

