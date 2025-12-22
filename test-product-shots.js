// Supabase Edge Function テストスクリプト
// product-shots関数をテストして、エラー内容を確認します

const SUPABASE_URL = 'https://ulfbddqwumeoqidxatyq.supabase.co';
const SUPABASE_ANON_KEY = 'あなたのANON_KEY'; // Supabase Dashboard → Settings → API → anon key

async function testProductShots() {
  console.log('🧪 product-shots関数をテスト中...\n');

  const testData = {
    productDescription: '白いTシャツ、シンプルなデザイン',
    brandId: 'test-brand-123',
    shots: ['front'] // 1枚だけテスト
  };

  try {
    console.log('📤 リクエスト送信:');
    console.log(JSON.stringify(testData, null, 2));
    console.log('');

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/product-shots`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(testData)
      }
    );

    console.log('📥 レスポンス:');
    console.log(`ステータス: ${response.status} ${response.statusText}`);
    console.log('');

    const responseText = await response.text();
    
    try {
      const data = JSON.parse(responseText);
      console.log('📄 レスポンスボディ:');
      console.log(JSON.stringify(data, null, 2));
      
      if (!response.ok) {
        console.log('\n❌ エラーが発生しました:');
        console.log(`エラーメッセージ: ${data.error || 'Unknown error'}`);
        console.log(`詳細: ${JSON.stringify(data)}`);
      } else {
        console.log('\n✅ 成功！画像が生成されました');
      }
    } catch (e) {
      console.log('📄 レスポンスボディ（テキスト）:');
      console.log(responseText);
    }

  } catch (error) {
    console.error('\n❌ リクエストエラー:');
    console.error(error.message);
    console.error(error.stack);
  }
}

// 実行
testProductShots();

