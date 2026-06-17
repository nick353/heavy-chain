import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { clientError, createServiceClient, createUserClient, requireBrandRole, requireUser } from '../_shared/auth.ts'
import { createOpenAiChatCompletion, hasOpenAiChatApiKey } from '../_shared/openaiChat.ts'
import { completeBrandUsage, reserveBrandUsage, type UsageReservation } from '../_shared/usage.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';
import { geminiGenerateContentUrl, geminiImageModel } from '../_shared/geminiModels.ts';

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
  let usageReservation: UsageReservation | null = null;
  let observedBrandId: string | null = null;
  let observedUserId: string | null = null;
  let telemetryClient: any = null;
  const functionName = 'generate-image';
  const requestId = requestIdFrom(req);
  const startedAt = Date.now();
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAuth = createUserClient(req)
    const user = await requireUser(supabaseAuth)
    console.log('User authenticated:', user.id)

    // Parse request body
    const { prompt, negativePrompt, width = 1024, height = 1024, brandId }: GenerateRequest = await req.json()

    if (!prompt) {
      throw new Error('Prompt is required')
    }

    if (!brandId) {
      throw new Error('Brand ID is required')
    }

    await requireBrandRole(supabaseAuth, brandId, user.id, 'editor')

    const supabaseClient = createServiceClient()
    telemetryClient = supabaseClient

    observedBrandId = brandId;
    observedUserId = user.id;
    usageReservation = await reserveBrandUsage(telemetryClient, {
      brandId,
      userId: user.id,
      functionName,
      units: 1,
      requestId,
      idempotencyKey: req.headers.get('idempotency-key'),
    });
    await recordEdgeFunctionRun(telemetryClient, {
      reservation: usageReservation,
      brandId,
      userId: user.id,
      functionName,
      status: 'started',
      requestId,
    });

    // Optimize prompt using OpenAI
    let optimizedPrompt = prompt
    const openaiImageApiKey = Deno.env.get('OPENAI_API_KEY')
    
    if (hasOpenAiChatApiKey()) {
      try {
        const optimizeResponse = await createOpenAiChatCompletion(
          {
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
          },
          'gpt-4o-mini',
        )

        const optimizeData = await optimizeResponse.json()
        if (optimizeData.choices?.[0]?.message?.content) {
          optimizedPrompt = optimizeData.choices[0].message.content
        }
      } catch (e) {
        console.error('Prompt optimization failed:', sanitizeError(e))
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
      throw new Error('Failed to create generation job')
    }
    console.log('Job created:', job.id)

    // Generate image using the configured Gemini image model first.
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
    const primaryGeminiImageModel = geminiImageModel()
    
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
      console.log(`Generating image with Gemini model: ${primaryGeminiImageModel}...`)
      
      try {
        const geminiResponse = await fetchWithTimeout(
          geminiGenerateContentUrl(primaryGeminiImageModel, geminiApiKey),
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
              usedModel = primaryGeminiImageModel
              console.log(`Image generated successfully with Gemini model: ${primaryGeminiImageModel}`)
              break
            }
          }
        }
        
        if (!imageBase64) {
          console.log('Nano Banana did not return image, trying Nano Banana Pro (gemini-3-pro-image)...')
          
          // Try Nano Banana Pro as fallback (slower but higher quality)
          const fallbackGeminiImageModel = 'gemini-3-pro-image'
          const nanoBananaResponse = await fetchWithTimeout(
            geminiGenerateContentUrl(fallbackGeminiImageModel, geminiApiKey),
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
                usedModel = fallbackGeminiImageModel
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
    if (!imageBase64 && openaiImageApiKey) {
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
          'Authorization': `Bearer ${openaiImageApiKey}`,
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

    const fileName = `${user.id}/${brandId}/${job.id}.png`
    const { error: uploadError } = await supabaseClient
      .storage
      .from('generated-images')
      .upload(fileName, imageBuffer, {
        contentType: 'image/png',
        upsert: false
      })

    if (uploadError) {
      await supabaseClient
        .from('generation_jobs')
        .update({ status: 'failed', error_message: 'Storage upload failed' })
        .eq('id', job.id)
      throw new Error('Storage upload failed')
    }

    // Calculate expiry (30 days)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)

    try {
      const { error: imageInsertError } = await supabaseClient
        .from('generated_images')
        .insert({
          job_id: job.id,
          brand_id: brandId,
          user_id: user.id,
          storage_path: fileName,
          image_url: null,
          prompt: optimizedPrompt,
          negative_prompt: negativePrompt || null,
          feature_type: 'text-to-image',
          model_used: usedModel,
          generation_params: { width, height },
          expires_at: expiresAt.toISOString()
        })
      if (imageInsertError) {
        throw imageInsertError
      }
      console.log('✅ Image record saved to database')

      // Update job status to completed
      await supabaseClient
        .from('generation_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', job.id)
    } catch (dbError) {
      console.error('Database save failed:', dbError)
      await supabaseClient
        .from('generation_jobs')
        .update({ status: 'failed', error_message: 'Failed to save generated image' })
        .eq('id', job.id)
      throw new Error('Failed to save generated image')
    }

    // Base64 Data URLを返す（確実に表示可能）
    if (telemetryClient) {
      await completeBrandUsage(telemetryClient, usageReservation, 'succeeded');
      await recordEdgeFunctionRun(telemetryClient, {
        reservation: usageReservation,
        brandId: observedBrandId,
        userId: observedUserId,
        functionName,
        status: 'succeeded',
        requestId,
        durationMs: durationSince(startedAt),
      });
    }


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
    if (telemetryClient) {
      await completeBrandUsage(telemetryClient, usageReservation, 'failed', { error: sanitizeError(error) });
      await recordEdgeFunctionRun(telemetryClient, {
        reservation: usageReservation,
        brandId: observedBrandId,
        userId: observedUserId,
        functionName,
        status: 'failed',
        requestId,
        durationMs: durationSince(startedAt),
        errorMessage: sanitizeError(error),
      });
    }

    console.error('Error:', error)
    return new Response(
      JSON.stringify({ 
        error: clientError(error)
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
