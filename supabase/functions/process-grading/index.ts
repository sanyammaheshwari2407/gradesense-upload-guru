import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    console.log('Processing grading request...')
    const { sessionId } = await req.json()
    console.log('Session ID:', sessionId)

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    console.log('Fetching session details...')
    const { data: session, error: sessionError } = await supabase
      .from('grading_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (sessionError) {
      console.error('Session error:', sessionError)
      throw new Error('Session not found')
    }

    if (!session) {
      console.error('No session found')
      throw new Error('Session not found')
    }

    console.log('Session found:', session)

    // Download files one at a time to prevent memory issues
    console.log('Downloading answer sheet...')
    const answerSheet = await supabase.storage
      .from('answer_sheets')
      .download(session.answer_sheet_path)

    if (!answerSheet.data) {
      throw new Error('Failed to download answer sheet')
    }

    // Convert answer sheet to base64
    const answerSheetBase64 = await answerSheet.data.arrayBuffer()
      .then(buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))))

    console.log('Calling Vision API...')
    const visionApiKey = Deno.env.get('GOOGLE_VISION_API_KEY')!
    const visionResponse = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [{
            image: {
              content: answerSheetBase64
            },
            features: [{
              type: 'DOCUMENT_TEXT_DETECTION'
            }]
          }]
        })
      }
    )

    const visionData = await visionResponse.json()
    console.log('Vision API response received')

    // Extract text from Vision API response
    const extractedText = visionData.responses?.[0]?.fullTextAnnotation?.text || ''
    console.log('Extracted text length:', extractedText.length)

    // Simple mock grading logic
    const answers = [
      {
        questionNumber: 1,
        text: extractedText.substring(0, 200),
        score: 8,
        maxScore: 10,
        feedback: "Good attempt, but missing some key points"
      },
      {
        questionNumber: 2,
        text: extractedText.substring(200, 400),
        score: 7,
        maxScore: 10,
        feedback: "Partial understanding demonstrated"
      }
    ]

    // Update session status
    const { error: updateError } = await supabase
      .from('grading_sessions')
      .update({ status: 'completed' })
      .eq('id', sessionId)

    if (updateError) {
      console.error('Update error:', updateError)
      throw updateError
    }

    console.log('Grading completed successfully')
    return new Response(
      JSON.stringify({
        message: 'Grading completed successfully',
        answers,
        totalScore: answers.reduce((sum, ans) => sum + ans.score, 0),
        maxPossibleScore: answers.reduce((sum, ans) => sum + ans.maxScore, 0)
      }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    )

  } catch (error) {
    console.error('Error processing grading:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})