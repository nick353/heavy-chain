#!/usr/bin/env node

/**
 * Heavy Chain 設定診断スクリプト
 * 
 * このスクリプトはSupabaseの設定状況を確認します。
 * 
 * 使用方法:
 * 1. SUPABASE_URLとSUPABASE_ANON_KEYを環境変数として設定
 * 2. node check-supabase.js を実行
 */

const https = require('https');

// 環境変数から取得（またはZeaburの設定値を使用）
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

console.log('🔍 Heavy Chain 設定診断を開始します...\n');

// 結果を格納
const results = {
  envVars: { ok: false, message: '' },
  connection: { ok: false, message: '' },
  edgeFunctions: [],
  recommendations: []
};

// Step 1: 環境変数の確認
console.log('📋 Step 1: 環境変数の確認');
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.log('❌ 環境変数が設定されていません');
  console.log('   VITE_SUPABASE_URL:', SUPABASE_URL ? '✅ 設定済み' : '❌ 未設定');
  console.log('   VITE_SUPABASE_ANON_KEY:', SUPABASE_ANON_KEY ? '✅ 設定済み' : '❌ 未設定');
  results.envVars.message = '環境変数が未設定です';
  results.recommendations.push('Zeaburダッシュボードで環境変数を設定してください');
  printResults();
  process.exit(1);
} else {
  console.log('✅ 環境変数が設定されています');
  console.log('   URL:', SUPABASE_URL.substring(0, 30) + '...');
  console.log('   Key:', SUPABASE_ANON_KEY.substring(0, 20) + '...');
  results.envVars.ok = true;
}

// Step 2: Supabase接続テスト
console.log('\n📡 Step 2: Supabase接続テスト');

function makeRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body ? JSON.parse(body) : null
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body
          });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function checkConnection() {
  try {
    const response = await makeRequest('/rest/v1/', 'GET');
    if (response.status === 200 || response.status === 404) {
      console.log('✅ Supabaseに接続できました');
      results.connection.ok = true;
      return true;
    } else {
      console.log(`❌ 接続エラー (Status: ${response.status})`);
      results.connection.message = `Status ${response.status}`;
      return false;
    }
  } catch (error) {
    console.log('❌ 接続エラー:', error.message);
    results.connection.message = error.message;
    results.recommendations.push('SupabaseのURLとキーが正しいか確認してください');
    return false;
  }
}

async function checkEdgeFunctions() {
  console.log('\n🚀 Step 3: Edge Functionsのテスト');
  
  const functions = [
    'generate-image',
    'product-shots',
    'colorize',
    'remove-background',
    'upscale'
  ];

  for (const funcName of functions) {
    try {
      const response = await makeRequest(`/functions/v1/${funcName}`, 'POST', { test: true });
      
      // Function exists if we get any response other than 404
      if (response.status === 404) {
        console.log(`❌ ${funcName}: デプロイされていません`);
        results.edgeFunctions.push({ name: funcName, deployed: false });
      } else {
        console.log(`✅ ${funcName}: デプロイ済み (Status: ${response.status})`);
        results.edgeFunctions.push({ name: funcName, deployed: true, status: response.status });
        
        // Check for API key errors
        if (response.body && typeof response.body === 'string') {
          if (response.body.includes('GEMINI_API_KEY')) {
            console.log(`   ⚠️  GEMINI_API_KEY が設定されていない可能性があります`);
            results.recommendations.push(`${funcName}: GEMINI_API_KEY を設定してください`);
          }
          if (response.body.includes('OPENAI_API_KEY')) {
            console.log(`   ⚠️  OPENAI_API_KEY が設定されていない可能性があります`);
            results.recommendations.push(`${funcName}: OPENAI_API_KEY を設定してください（推奨）`);
          }
        }
      }
    } catch (error) {
      console.log(`⚠️  ${funcName}: 確認できませんでした (${error.message})`);
      results.edgeFunctions.push({ name: funcName, deployed: 'unknown', error: error.message });
    }
  }
}

async function checkTables() {
  console.log('\n📊 Step 4: データベーステーブルの確認');
  
  const tables = ['brands', 'generated_images', 'folders'];
  
  for (const table of tables) {
    try {
      const response = await makeRequest(`/rest/v1/${table}?select=count&limit=1`);
      
      if (response.status === 200) {
        console.log(`✅ ${table}: 存在します`);
      } else if (response.status === 404 || response.status === 406) {
        console.log(`❌ ${table}: テーブルが存在しません`);
        results.recommendations.push(`データベーススキーマを適用してください (001_initial_schema.sql)`);
      } else {
        console.log(`⚠️  ${table}: Status ${response.status}`);
      }
    } catch (error) {
      console.log(`❌ ${table}: エラー (${error.message})`);
    }
  }
}

function printResults() {
  console.log('\n' + '='.repeat(60));
  console.log('📋 診断結果サマリー');
  console.log('='.repeat(60));
  
  console.log('\n環境変数:', results.envVars.ok ? '✅ OK' : '❌ NG');
  console.log('Supabase接続:', results.connection.ok ? '✅ OK' : '❌ NG');
  
  if (results.edgeFunctions.length > 0) {
    const deployed = results.edgeFunctions.filter(f => f.deployed === true).length;
    const total = results.edgeFunctions.length;
    console.log(`Edge Functions: ${deployed}/${total} デプロイ済み`);
    
    const notDeployed = results.edgeFunctions.filter(f => f.deployed === false);
    if (notDeployed.length > 0) {
      console.log('\n未デプロイの関数:');
      notDeployed.forEach(f => console.log(`  - ${f.name}`));
    }
  }
  
  if (results.recommendations.length > 0) {
    console.log('\n🔧 推奨アクション:');
    results.recommendations.forEach((rec, i) => {
      console.log(`${i + 1}. ${rec}`);
    });
  }
  
  console.log('\n' + '='.repeat(60));
}

// メイン処理
(async () => {
  try {
    const connected = await checkConnection();
    if (connected) {
      await checkEdgeFunctions();
      await checkTables();
    }
    
    printResults();
    
    // Exit code
    const hasIssues = !results.envVars.ok || 
                     !results.connection.ok || 
                     results.edgeFunctions.some(f => f.deployed === false) ||
                     results.recommendations.length > 0;
    
    if (hasIssues) {
      console.log('\n⚠️  いくつかの問題が見つかりました。上記の推奨アクションを確認してください。');
      process.exit(1);
    } else {
      console.log('\n✅ すべての設定が正常です！');
      process.exit(0);
    }
  } catch (error) {
    console.error('\n❌ 診断中にエラーが発生しました:', error);
    process.exit(1);
  }
})();

