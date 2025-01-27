import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_PAGES = 3; // MVP: Limit to first 3 pages
const CHUNK_SIZE = 1000000; // 1MB chunks for processing

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    console.log('Processing grading request...')
    const { sessionId } = await req.json()
    console.log('Session ID:', sessionId)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Fetch session details
    const { data: session, error: sessionError } = await supabase
      .from('grading_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (sessionError) {
      throw new Error(`Session not found: ${sessionError.message}`)
    }

    // Download and process answer sheet first
    console.log('Downloading answer sheet...')
    const { data: answerSheetData, error: downloadError } = await supabase.storage
      .from('answer_sheets')
      .download(session.answer_sheet_path)

    if (downloadError || !answerSheetData) {
      throw new Error('Failed to download answer sheet')
    }

    // Convert to base64 in chunks
    const chunks = []
    const reader = new FileReader()
    const buffer = await answerSheetData.arrayBuffer()
    
    for (let i = 0; i < buffer.byteLength; i += CHUNK_SIZE) {
      const chunk = buffer.slice(i, i + CHUNK_SIZE)
      const base64Chunk = btoa(String.fromCharCode(...new Uint8Array(chunk)))
      chunks.push(base64Chunk)
    }

    // Process chunks with Vision API
    console.log('Processing with Vision API...')
    let extractedText = ''
    
    for (const chunk of chunks) {
      const visionResponse = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${Deno.env.get('GOOGLE_VISION_API_KEY')}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              image: { content: chunk },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
            }]
          })
        }
      )

      const visionData = await visionResponse.json()
      if (visionData.responses?.[0]?.fullTextAnnotation?.text) {
        extractedText += visionData.responses[0].fullTextAnnotation.text + '\n'
      }
    }

    // Process question paper and rubric (MVP: basic text extraction)
    console.log('Processing question paper and rubric...')
    const [questionPaper, gradingRubric] = await Promise.all([
      supabase.storage.from('question_papers').download(session.question_paper_path),
      supabase.storage.from('grading_rubrics').download(session.grading_rubric_path)
    ])

    if (!questionPaper.data || !gradingRubric.data) {
      throw new Error('Failed to download question paper or rubric')
    }

    const questionPaperText = await questionPaper.data.text()
    const gradingRubricText = await gradingRubric.data.text()

    // Process with Gemini API
    console.log('Processing with Gemini API...')
    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('GEMINI_API_KEY')}`
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are a grading assistant. Please grade the following student answer based on the question paper and grading rubric. 
              Provide a simplified MVP grading with scores and brief feedback.
              
              Question Paper:
              ${questionPaperText.substring(0, 1000)} // MVP: Limit text length
              
              Grading Rubric:
              ${gradingRubricText.substring(0, 1000)} // MVP: Limit text length
              
              Student Answer:
              ${extractedText.substring(0, 1000)} // MVP: Limit text length
              
              Please provide:
              1. Score (out of 100)
              2. Brief feedback (2-3 sentences)
              3. Key areas for improvement`
            }]
          }]
        })
      }
    )

    const geminiData = await geminiResponse.json()
    console.log('Gemini API response received')

    if (!geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Failed to process grading with Gemini')
    }

    const gradingResults = geminiData.candidates[0].content.parts[0].text

    // Update session status
    await supabase
      .from('grading_sessions')
      .update({ status: 'completed' })
      .eq('id', sessionId)

    console.log('Grading completed successfully')
    return new Response(
      JSON.stringify({
        message: 'Grading completed successfully',
        results: gradingResults
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error processing grading:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})