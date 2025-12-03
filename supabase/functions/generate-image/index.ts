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

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } }
      }
    )

    // Get user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      throw new Error('Unauthorized')
    }

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
      throw new Error(`Failed to create job: ${jobError.message}`)
    }

    // Generate image using Gemini API with Imagen
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiApiKey) {
      throw new Error('Gemini API key not configured')
    }

    // Use Gemini 2.0 Flash for image generation
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Generate a high-quality fashion/apparel photograph: ${optimizedPrompt}. 
              Style: Professional fashion photography, studio lighting, high resolution, commercial quality.
              ${negativePrompt ? `Avoid: ${negativePrompt}` : ''}`
            }]
          }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
          }
        }),
      }
    )

    const geminiData = await geminiResponse.json()
    
    if (!geminiResponse.ok) {
      console.error('Gemini API error:', JSON.stringify(geminiData))
      
      // Try with Imagen 3 as fallback
      const imagenResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            instances: [{
              prompt: `Professional fashion photography: ${optimizedPrompt}. High quality, studio lighting, commercial style.`
            }],
            parameters: {
              sampleCount: 1,
              aspectRatio: width === height ? '1:1' : (width > height ? '16:9' : '9:16'),
              negativePrompt: negativePrompt || 'low quality, blurry, distorted'
            }
          }),
        }
      )

      if (!imagenResponse.ok) {
        const imagenError = await imagenResponse.text()
        console.error('Imagen API error:', imagenError)
        
        await supabaseClient
          .from('generation_jobs')
          .update({ status: 'failed', error_message: 'Image generation API error' })
          .eq('id', job.id)

        throw new Error('Image generation failed - API error')
      }

      const imagenData = await imagenResponse.json()
      
      if (imagenData.predictions?.[0]?.bytesBase64Encoded) {
        const imageBase64 = imagenData.predictions[0].bytesBase64Encoded
        const imageBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0))
        
        const fileName = `${brandId}/${user.id}/${job.id}.png`
        
        const { error: uploadError } = await supabaseClient
          .storage
          .from('generated-images')
          .upload(fileName, imageBuffer, {
            contentType: 'image/png',
            upsert: false
          })

        if (uploadError) {
          throw new Error(`Failed to upload image: ${uploadError.message}`)
        }

        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + 30)

        const { data: imageRecord, error: imageError } = await supabaseClient
          .from('generated_images')
          .insert({
            job_id: job.id,
            brand_id: brandId,
            user_id: user.id,
            storage_path: fileName,
            expires_at: expiresAt.toISOString()
          })
          .select()
          .single()

        if (imageError) {
          throw new Error(`Failed to save image record: ${imageError.message}`)
        }

        await supabaseClient
          .from('generation_jobs')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', job.id)

        const { data: urlData } = supabaseClient
          .storage
          .from('generated-images')
          .getPublicUrl(fileName)

        return new Response(
          JSON.stringify({
            success: true,
            images: [{
              id: imageRecord.id,
              imageUrl: urlData.publicUrl,
              prompt: optimizedPrompt
            }]
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          }
        )
      }
    }
    
    // Extract image from Gemini response
    let imageBase64: string | null = null
    
    if (geminiData.candidates?.[0]?.content?.parts) {
      for (const part of geminiData.candidates[0].content.parts) {
        if (part.inlineData?.mimeType?.startsWith('image/')) {
          imageBase64 = part.inlineData.data
          break
        }
      }
    }

    if (!imageBase64) {
      // If no image, return a placeholder response with the generated text
      await supabaseClient
        .from('generation_jobs')
        .update({ status: 'failed', error_message: 'No image in response - text generation only' })
        .eq('id', job.id)

      // Return generated text if available
      const textContent = geminiData.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || ''
      
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Image generation not available. The model returned text only.',
          text: textContent,
          message: 'Please try again or use a different prompt.'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    // Convert base64 to Uint8Array
    const imageBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0))

    // Upload to Supabase Storage
    const fileName = `${brandId}/${user.id}/${job.id}.png`
    
    const { error: uploadError } = await supabaseClient
      .storage
      .from('generated-images')
      .upload(fileName, imageBuffer, {
        contentType: 'image/png',
        upsert: false
      })

    if (uploadError) {
      throw new Error(`Failed to upload image: ${uploadError.message}`)
    }

    // Calculate expiry (30 days)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)

    // Save generated image record
    const { data: imageRecord, error: imageError } = await supabaseClient
      .from('generated_images')
      .insert({
        job_id: job.id,
        brand_id: brandId,
        user_id: user.id,
        storage_path: fileName,
        expires_at: expiresAt.toISOString()
      })
      .select()
      .single()

    if (imageError) {
      throw new Error(`Failed to save image record: ${imageError.message}`)
    }

    // Update job status to completed
    await supabaseClient
      .from('generation_jobs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', job.id)

    // Get public URL
    const { data: urlData } = supabaseClient
      .storage
      .from('generated-images')
      .getPublicUrl(fileName)

    return new Response(
      JSON.stringify({
        success: true,
        images: [{
          id: imageRecord.id,
          imageUrl: urlData.publicUrl,
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
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
