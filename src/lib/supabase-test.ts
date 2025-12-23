// Supabase Configuration Check Tool
// このファイルを一時的に使用して、Supabase接続を確認します

import { createClient } from '@supabase/supabase-js';

// ⚠️ セキュリティ警告: 
// このファイルは開発用です。本番環境では環境変数を使用してください。

// TODO: SupabaseのProject URLをここに入力してください
// ダッシュボードの Settings > API > Project URL からコピーできます
const SUPABASE_URL = 'YOUR_SUPABASE_URL_HERE'; // 例: https://xxxxx.supabase.co

// 提供されたanon key
const SUPABASE_ANON_KEY = 'sbp_257c591725f8def68c6316c5859a76c31845979c';

// Supabaseクライアントを作成
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 接続テスト関数
export async function testSupabaseConnection() {
  console.log('🔍 Supabase接続をテスト中...');
  console.log('URL:', SUPABASE_URL);
  console.log('Key:', SUPABASE_ANON_KEY.substring(0, 20) + '...');

  try {
    // 1. 認証状態を確認
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    console.log('✅ 認証状態:', session ? '認証済み' : '未認証');
    if (authError) console.error('❌ 認証エラー:', authError);

    // 2. ストレージバケットを確認
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    if (bucketsError) {
      console.error('❌ ストレージバケットの取得に失敗:', bucketsError);
    } else {
      console.log('✅ ストレージバケット:', buckets?.map(b => b.name).join(', ') || 'なし');
      
      // generated-imagesバケットの確認
      const generatedImagesExists = buckets?.find(b => b.name === 'generated-images');
      if (generatedImagesExists) {
        console.log('✅ generated-imagesバケットが存在します');
        console.log('   Public:', generatedImagesExists.public ? 'はい' : 'いいえ');
      } else {
        console.warn('⚠️ generated-imagesバケットが見つかりません');
      }
    }

    // 3. データベーステーブルを確認
    const { error: tablesError } = await supabase
      .from('generated_images')
      .select('count', { count: 'exact', head: true });
    
    if (tablesError) {
      console.error('❌ generated_imagesテーブルへのアクセスに失敗:', tablesError);
      console.log('   → setup.sqlを実行してテーブルを作成してください');
    } else {
      console.log('✅ generated_imagesテーブルにアクセス可能');
    }

    // 4. サンプル画像データを取得
    const { data: images, error: imagesError } = await supabase
      .from('generated_images')
      .select('*')
      .limit(1);
    
    if (!imagesError && images && images.length > 0) {
      console.log('✅ サンプル画像データ:', images[0]);
      
      // 画像URLを生成
      const { data: urlData } = supabase.storage
        .from('generated-images')
        .getPublicUrl(images[0].storage_path);
      
      console.log('📷 画像URL:', urlData.publicUrl);
      
      // URLが実際にアクセス可能か確認
      try {
        const response = await fetch(urlData.publicUrl, { method: 'HEAD' });
        if (response.ok) {
          console.log('✅ 画像ファイルにアクセス可能です');
        } else {
          console.error('❌ 画像ファイルにアクセスできません (ステータス:', response.status, ')');
          console.log('   → storage-setup.sqlを実行してポリシーを設定してください');
        }
      } catch (fetchError) {
        console.error('❌ 画像ファイルの確認に失敗:', fetchError);
      }
    } else {
      console.log('ℹ️ 画像データがまだありません（これは正常です）');
    }

    return true;
  } catch (error) {
    console.error('❌ 接続テスト中にエラーが発生:', error);
    return false;
  }
}

// ブラウザのコンソールで実行できるようにする
if (typeof window !== 'undefined') {
  (window as any).testSupabaseConnection = testSupabaseConnection;
  console.log('💡 ブラウザのコンソールで testSupabaseConnection() を実行してテストできます');
}

