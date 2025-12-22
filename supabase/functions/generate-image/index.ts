import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface GenerateRequest {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  brandId: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get auth header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    // Initialize Supabase client for auth check
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } }
      }
    )

    // Get user
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser()
    if (userError || !user) {
      console.error('Auth error:', userError)
      throw new Error(`Unauthorized: ${userError?.message || 'No user found'}`)
    }
    console.log('User authenticated:', user.id)
    
    // Initialize Supabase client with service role for database operations
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceRoleKey) {
      throw new Error('Service role key not configured')
    }
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Parse request body
    const { prompt, negativePrompt, width = 1024, height = 1024, brandId }: GenerateRequest = await req.json()

    if (!prompt) {
      throw new Error('Prompt is required')
    }

    if (!brandId) {
      throw new Error('Brand ID is required')
    }

    // Optimize prompt using OpenAI
    let optimizedPrompt = prompt
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    
    if (openaiApiKey) {
      try {
        const optimizeResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `You are an expert at writing image generation prompts. Convert the user's Japanese description into an optimized English prompt for fashion/apparel image generation. Focus on: lighting, composition, style, details. Keep it concise but detailed. Output only the English prompt, nothing else.`
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            max_tokens: 300,
          }),
        })

        const optimizeData = await optimizeResponse.json()
        if (optimizeData.choices?.[0]?.message?.content) {
          optimizedPrompt = optimizeData.choices[0].message.content
        }
      } catch (e) {
        console.error('Prompt optimization failed:', e)
      }
    }

    // Create generation job
    const { data: job, error: jobError } = await supabaseClient
      .from('generation_jobs')
      .insert({
        brand_id: brandId,
        user_id: user.id,
        feature_type: 'text-to-image',
        input_params: { prompt, negativePrompt, width, height },
        optimized_prompt: optimizedPrompt,
        status: 'processing'
      })
      .select()
      .single()

    if (jobError) {
      console.error('Job creation error:', jobError)
      throw new Error(`Failed to create job: ${jobError.message} (code: ${jobError.code}, details: ${jobError.details})`)
    }
    console.log('Job created:', job.id)

    // Generate image using Gemini 2.0 Flash (NanoBanana Pro)
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
    
    let imageBase64: string | null = null
    let usedModel = 'unknown'

    // Helper function for fetch with timeout
    const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number = 50000) => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch(url, { ...options, signal: controller.signal })
        clearTimeout(timeoutId)
        return response
      } catch (error) {
        clearTimeout(timeoutId)
        throw error
      }
    }

    // Try Gemini Nano Banana first (faster than Pro)
    if (geminiApiKey) {
      console.log('Generating image with Nano Banana (gemini-2.5-flash-image)...')
      
      try {
        // Try Nano Banana first (gemini-2.5-flash-image) - much faster than Pro
        const geminiResponse = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiApiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: `Generate a high-quality professional fashion/apparel image: ${optimizedPrompt}. 
                  Style: Professional fashion photography, studio lighting, high resolution, commercial quality.
                  ${negativePrompt ? `Avoid: ${negativePrompt}` : ''}`
                }]
              }],
              generationConfig: {
                responseModalities: ["IMAGE", "TEXT"]
              }
            }),
          },
          30000 // 30 second timeout for Nano Banana
        )

        const geminiData = await geminiResponse.json()
        console.log('Nano Banana response status:', geminiResponse.status)
        
        if (geminiResponse.ok && geminiData.candidates?.[0]?.content?.parts) {
          // Find the image part in the response
          for (const part of geminiData.candidates[0].content.parts) {
            if (part.inlineData?.data) {
              imageBase64 = part.inlineData.data
              usedModel = 'nano-banana'
              console.log('Image generated successfully with Nano Banana')
              break
            }
          }
        }
        
        if (!imageBase64) {
          console.log('Nano Banana did not return image, trying Nano Banana Pro (gemini-3-pro-image-preview)...')
          
          // Try Nano Banana Pro as fallback (slower but higher quality)
          const nanoBananaResponse = await fetchWithTimeout(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${geminiApiKey}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                contents: [{
                  parts: [{
                    text: `Generate a high-quality professional fashion/apparel image: ${optimizedPrompt}. 
                    Style: Professional fashion photography, studio lighting, high resolution, commercial quality.
                    ${negativePrompt ? `Avoid: ${negativePrompt}` : ''}`
                  }]
                }],
                generationConfig: {
                  responseModalities: ["IMAGE", "TEXT"]
                }
              }),
            },
            20000 // 20 second timeout for Nano Banana
          )
          
          const nanoBananaData = await nanoBananaResponse.json()
          console.log('Nano Banana Pro response status:', nanoBananaResponse.status)
          
          if (nanoBananaResponse.ok && nanoBananaData.candidates?.[0]?.content?.parts) {
            for (const part of nanoBananaData.candidates[0].content.parts) {
              if (part.inlineData?.data) {
                imageBase64 = part.inlineData.data
                usedModel = 'nano-banana-pro'
                console.log('Image generated successfully with Nano Banana Pro')
                break
              }
            }
          } else {
            console.log('Nano Banana Pro error:', JSON.stringify(nanoBananaData))
          }
        }
      } catch (e) {
        console.error('Gemini error:', e)
      }
    }

    // Fallback to DALL-E 3 if Gemini failed
    if (!imageBase64 && openaiApiKey) {
      console.log('Falling back to DALL-E 3...')
      
      let dalleSize: '1024x1024' | '1792x1024' | '1024x1792' = '1024x1024'
      if (width > height) {
        dalleSize = '1792x1024'
      } else if (height > width) {
        dalleSize = '1024x1792'
      }

      const dalleResponse = await fetchWithTimeout('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: `Professional fashion photography: ${optimizedPrompt}. High quality, commercial style, clean composition. ${negativePrompt ? `Avoid: ${negativePrompt}` : ''}`,
          n: 1,
          size: dalleSize,
          quality: 'standard',
          response_format: 'b64_json'
        }),
      }, 50000)

      const dalleData = await dalleResponse.json()
      
      if (!dalleResponse.ok) {
        console.error('DALL-E API error:', JSON.stringify(dalleData))
        
        await supabaseClient
          .from('generation_jobs')
          .update({ status: 'failed', error_message: dalleData.error?.message || 'Image generation API error' })
          .eq('id', job.id)

        throw new Error(`Image generation failed: ${dalleData.error?.message || 'API error'}`)
      }

      imageBase64 = dalleData.data?.[0]?.b64_json
      usedModel = 'dall-e-3'
      console.log('Image generated successfully with DALL-E 3')
    }

    if (!imageBase64) {
      throw new Error('No image generation API available or all APIs failed')
    }
    console.log(`Image generated with model: ${usedModel}`)

    // Base64 Data URLを作成（ブラウザで直接表示可能）
    const imageDataUrl = `data:image/png;base64,${imageBase64}`

    // Convert base64 to Uint8Array for storage
    const imageBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0))

    // Upload to Supabase Storage (non-blocking)
    const fileName = `${brandId}/${user.id}/${job.id}.png`
    
    try {
      await supabaseClient
        .storage
        .from('generated-images')
        .upload(fileName, imageBuffer, {
          contentType: 'image/png',
          upsert: false
        })

      // Calculate expiry (30 days)
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 30)

      // Save generated image record
      await supabaseClient
        .from('generated_images')
        .insert({
          job_id: job.id,
          brand_id: brandId,
          user_id: user.id,
          storage_path: fileName,
          expires_at: expiresAt.toISOString()
        })

      // Update job status to completed
      await supabaseClient
        .from('generation_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', job.id)
    } catch (storageError) {
      console.log('⚠️ Storage warning (non-critical):', storageError.message)
    }

    // Base64 Data URLを返す（確実に表示可能）
    return new Response(
      JSON.stringify({
        success: true,
        images: [{
          id: job.id,
          imageUrl: imageDataUrl,
          prompt: optimizedPrompt
        }]
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error.toString(),
        stack: error.stack 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
