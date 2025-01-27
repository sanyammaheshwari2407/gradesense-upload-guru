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

    // Fetch session details
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

    console.log('Session found:', session)

    // Download files sequentially to prevent memory issues
    console.log('Downloading answer sheet...')
    const answerSheet = await supabase.storage
      .from('answer_sheets')
      .download(session.answer_sheet_path)

    if (!answerSheet.data) {
      throw new Error('Failed to download answer sheet')
    }

    // Convert answer sheet to base64 for Vision API
    const answerSheetBase64 = await answerSheet.data.arrayBuffer()
      .then(buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))))

    // Call Vision API to extract text
    console.log('Calling Vision API...')
    const visionResponse = await fetch('https://vision.googleapis.com/v1/images:annotate?key=' + Deno.env.get('GOOGLE_VISION_API_KEY'), {
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
    })

    const visionData = await visionResponse.json()
    console.log('Vision API response received')

    if (!visionData.responses?.[0]?.fullTextAnnotation?.text) {
      throw new Error('Failed to extract text from answer sheet')
    }

    const extractedText = visionData.responses[0].fullTextAnnotation.text

    // Download question paper and rubric
    console.log('Downloading question paper and rubric...')
    const [questionPaper, gradingRubric] = await Promise.all([
      supabase.storage.from('question_papers').download(session.question_paper_path),
      supabase.storage.from('grading_rubrics').download(session.grading_rubric_path)
    ])

    if (!questionPaper.data || !gradingRubric.data) {
      throw new Error('Failed to download question paper or rubric')
    }

    // Convert files to text
    const questionPaperText = await questionPaper.data.text()
    const gradingRubricText = await gradingRubric.data.text()

    // Call Gemini API for processing and grading
    console.log('Calling Gemini API...')
    const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('GEMINI_API_KEY')}`
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are a grading assistant. Please grade the following student answer based on the question paper and grading rubric.
            
            Question Paper:
            ${questionPaperText}
            
            Grading Rubric:
            ${gradingRubricText}
            
            Student Answer (extracted from handwritten sheet):
            ${extractedText}
            
            Please provide:
            1. Score for each question
            2. Detailed feedback for each answer
            3. Explanation of any deductions
            4. Overall score and comments`
          }]
        }]
      })
    })

    const geminiData = await geminiResponse.json()
    console.log('Gemini API response received')

    if (!geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Failed to process grading with Gemini')
    }

    const gradingResults = geminiData.candidates[0].content.parts[0].text

    // Update session status
    const { error: updateError } = await supabase
      .from('grading_sessions')
      .update({ 
        status: 'completed',
      })
      .eq('id', sessionId)

    if (updateError) {
      console.error('Update error:', updateError)
      throw updateError
    }

    console.log('Grading completed successfully')
    return new Response(
      JSON.stringify({
        message: 'Grading completed successfully',
        results: gradingResults
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