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
  featureType?: string
  sourceReadback?: unknown
  generationIntent?: unknown
  campaignMeta?: unknown
  textOverlay?: unknown
}

const SOURCE_CONFIG = {
  studio: { label: 'Fashion Studio', resumePath: '/studio', versions: ['studio-selection-local-v1'] },
  models: { label: 'モデルライブラリ', resumePath: '/models', versions: ['model-library-local-v1'] },
  patterns: { label: '柄・グラフィック', resumePath: '/patterns', versions: ['pattern-preview-local-v1'] },
  video: { label: 'Video Workstation', resumePath: '/video', versions: ['video-storyboard-local-v1'] },
  lab: { label: 'Lab', resumePath: '/lab', versions: ['lab-evaluation-local-v1'] },
} as const

type SourceWorkspace = keyof typeof SOURCE_CONFIG

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const readString = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const sanitizeSourceReadback = (value: unknown) => {
  if (!isRecord(value)) return null

  const sourceWorkspace = readString(value, 'sourceWorkspace')
  if (!sourceWorkspace || !(sourceWorkspace in SOURCE_CONFIG)) return null

  const config = SOURCE_CONFIG[sourceWorkspace as SourceWorkspace]
  const workflowVersion = readString(value, 'workflowVersion')
  const sourceLabel = readString(value, 'sourceLabel')
  const sourceResumePath = readString(value, 'sourceResumePath')
  const sourceMode = readString(value, 'sourceMode')

  if (!workflowVersion || !(config.versions as readonly string[]).includes(workflowVersion)) return null
  if (sourceLabel !== config.label) return null
  if (sourceResumePath !== config.resumePath) return null
  if (sourceMode !== 'local-workflow-intake') return null

  return {
    sourceWorkspace: sourceWorkspace as SourceWorkspace,
    workflowVersion,
    sourceLabel,
    sourceResumePath,
    sourceMode: 'local-workflow-intake' as const,
  }
}

const sanitizeGenerationIntent = (value: unknown, source: ReturnType<typeof sanitizeSourceReadback>) => {
  if (!source || !isRecord(value)) return null
  const feature = readString(value, 'feature')
  const prompt = readString(value, 'prompt')
  const href = readString(value, 'href')
  const label = readString(value, 'label')
  if (!feature || !prompt || !href || !label) return null
  if (readString(value, 'sourceWorkspace') !== source.sourceWorkspace) return null
  if (readString(value, 'workflowVersion') !== source.workflowVersion) return null
  if (readString(value, 'sourceLabel') !== source.sourceLabel) return null
  if (readString(value, 'sourceResumePath') !== source.sourceResumePath) return null
  if (readString(value, 'sourceMode') !== source.sourceMode) return null

  return {
    feature,
    prompt,
    href,
    label,
    ...source,
    ...(readString(value, 'aspectRatio') ? { aspectRatio: readString(value, 'aspectRatio') } : {}),
  }
}

const buildSourceMetadata = (sourceReadback: unknown, generationIntent: unknown) => {
  const source = sanitizeSourceReadback(sourceReadback)
  if (!source) return null
  return {
    ...source,
    ...(sanitizeGenerationIntent(generationIntent, source)
      ? { generationIntent: sanitizeGenerationIntent(generationIntent, source) }
      : {}),
  }
}

serve(async (req) => {
  let usageReservation: UsageReservation | null = null;
  let observedBrandId: string | null = null;
  let observedUserId: string | null = null;
  let telemetryClient: any = null;
  let persistenceStatus: 'not_started' | 'processing' | 'completed' | 'failed' = 'not_started';
  let failedStage: string | null = null;
  let cleanupStatus: 'none' | 'attempted' | 'failed' = 'none';
  let jobId: string | null = null;
  let storagePath: string | null = null;
  const uploadedStoragePaths: string[] = [];
  const insertedImageIds: string[] = [];
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
    const {
      prompt,
      negativePrompt,
      width = 1024,
      height = 1024,
      brandId,
      featureType,
      sourceReadback,
      generationIntent,
      campaignMeta,
      textOverlay,
    }: GenerateRequest = await req.json()

    if (!prompt) {
      throw new Error('Prompt is required')
    }

    if (!brandId) {
      throw new Error('Brand ID is required')
    }

    await requireBrandRole(supabaseAuth, brandId, user.id, 'editor')

    const supabaseClient = createServiceClient()
    telemetryClient = supabaseClient
    const persistedFeatureType = typeof featureType === 'string' && featureType.trim()
      ? featureType.trim()
      : 'text-to-image'
    const sourceMetadata = buildSourceMetadata(sourceReadback, generationIntent)
    const inputParams = {
      prompt,
      negativePrompt,
      width,
      height,
      featureType: persistedFeatureType,
      requestId,
      ...(isRecord(campaignMeta) ? { campaignMeta } : {}),
      ...(isRecord(textOverlay) ? { textOverlay } : {}),
      ...(sourceMetadata ?? {}),
    }

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
    failedStage = 'job'
    const { data: job, error: jobError } = await supabaseClient
      .from('generation_jobs')
      .insert({
        brand_id: brandId,
        user_id: user.id,
        feature_type: persistedFeatureType,
        input_params: inputParams as any,
        optimized_prompt: optimizedPrompt,
        status: 'processing'
      })
      .select()
      .single()

    if (jobError) {
      console.error('Job creation error:', jobError)
      throw new Error('Failed to create generation job')
    }
    jobId = job.id
    persistenceStatus = 'processing'
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

        failedStage = 'generation'
        throw new Error(`Image generation failed: ${dalleData.error?.message || 'API error'}`)
      }

      imageBase64 = dalleData.data?.[0]?.b64_json
      usedModel = 'dall-e-3'
      console.log('Image generated successfully with DALL-E 3')
    }

    if (!imageBase64) {
      failedStage = 'generation'
      throw new Error('No image generation API available or all APIs failed')
    }
    console.log(`Image generated with model: ${usedModel}`)

    // Base64 Data URLを作成（ブラウザで直接表示可能）
    const imageDataUrl = `data:image/png;base64,${imageBase64}`

    // Convert base64 to Uint8Array for storage
    const imageBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0))

    const fileName = `${user.id}/${brandId}/${job.id}.png`
    storagePath = fileName
    failedStage = 'storage'
    const { error: uploadError } = await supabaseClient
      .storage
      .from('generated-images')
      .upload(fileName, imageBuffer, {
        contentType: 'image/png',
        upsert: false
      })

    if (uploadError) {
      throw new Error('Storage upload failed')
    }
    uploadedStoragePaths.push(fileName)

    // Calculate expiry (30 days)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)
    let imageId: string | null = null

    try {
      failedStage = 'image'
      const { data: image, error: imageInsertError } = await supabaseClient
        .from('generated_images')
        .insert({
          job_id: job.id,
          brand_id: brandId,
          user_id: user.id,
          storage_path: fileName,
          image_url: null,
          prompt: optimizedPrompt,
          negative_prompt: negativePrompt || null,
          feature_type: persistedFeatureType,
          model_used: usedModel,
          generation_params: { width, height },
          metadata: {
            remoteSaveStatus: 'succeeded',
            source: 'generate-image',
            requestId,
            ...(sourceMetadata ?? {}),
          },
          expires_at: expiresAt.toISOString()
        })
        .select('id')
        .single()
      if (imageInsertError || !image?.id) {
        throw imageInsertError ?? new Error('Generated image insert did not return an id')
      }
      imageId = image?.id ?? null
      if (imageId) {
        insertedImageIds.push(imageId)
      }
      console.log('✅ Image record saved to database')

      // Update job status to completed
      failedStage = 'job_complete'
      const { error: completeJobError } = await supabaseClient
        .from('generation_jobs')
        .update({ status: 'completed', error_message: null, completed_at: new Date().toISOString() })
        .eq('id', job.id)
      if (completeJobError) {
        throw completeJobError
      }
      persistenceStatus = 'completed'
      failedStage = null
    } catch (dbError) {
      console.error('Database save failed:', dbError)
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
        jobId: job.id,
        imageId,
        storagePath: fileName,
        persistenceStatus: 'completed',
        cleanupStatus: 'none',
        images: [{
          id: imageId ?? job.id,
          imageUrl: imageDataUrl,
          prompt: optimizedPrompt,
          jobId: job.id,
          imageId,
          storagePath: fileName,
          persistenceStatus: 'completed'
        }]
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    const cleanupErrors: string[] = [];
    persistenceStatus = jobId ? 'failed' : persistenceStatus;
    if (!failedStage) failedStage = 'unknown';

    if (telemetryClient && jobId) {
      cleanupStatus = 'attempted';
      if (insertedImageIds.length > 0) {
        try {
          const { error: deleteImagesError } = await telemetryClient
            .from('generated_images')
            .delete()
            .in('id', insertedImageIds);
          if (deleteImagesError) throw deleteImagesError;
        } catch (cleanupError) {
          cleanupErrors.push(clientError(cleanupError));
        }
      }

      if (uploadedStoragePaths.length > 0) {
        try {
          const { error: removeStorageError } = await telemetryClient
            .storage
            .from('generated-images')
            .remove(uploadedStoragePaths);
          if (removeStorageError) throw removeStorageError;
        } catch (cleanupError) {
          cleanupErrors.push(clientError(cleanupError));
        }
      }

      try {
        const { error: failJobError } = await telemetryClient
          .from('generation_jobs')
          .update({
            status: 'failed',
            error_message: sanitizeError(error),
            completed_at: new Date().toISOString(),
          })
          .eq('id', jobId);
        if (failJobError) throw failJobError;
      } catch (cleanupError) {
        cleanupErrors.push(clientError(cleanupError));
      }

      cleanupStatus = cleanupErrors.length ? 'failed' : 'attempted';
    }

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
        success: false,
        error: clientError(error),
        jobId,
        storagePath,
        persistenceStatus,
        failedStage,
        cleanupStatus,
        cleanupErrors,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
