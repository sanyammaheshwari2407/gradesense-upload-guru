import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import { GoogleGenerativeAI } from 'npm:@google/generative-ai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

    // Download all necessary files
    console.log('Downloading files...')
    const [questionPaperRes, gradingRubricRes, answerSheetRes] = await Promise.all([
      supabase.storage.from('question_papers').download(session.question_paper_path),
      supabase.storage.from('grading_rubrics').download(session.grading_rubric_path),
      supabase.storage.from('answer_sheets').download(session.answer_sheet_path)
    ]);

    if (!questionPaperRes.data || !gradingRubricRes.data || !answerSheetRes.data) {
      throw new Error('Failed to download one or more required files')
    }

    // Convert Blob data to text using Response API
    const [questionPaper, gradingRubric, answerSheet] = await Promise.all([
      new Response(questionPaperRes.data).arrayBuffer().then(buffer => new TextDecoder().decode(buffer)),
      new Response(gradingRubricRes.data).arrayBuffer().then(buffer => new TextDecoder().decode(buffer)),
      new Response(answerSheetRes.data).arrayBuffer().then(buffer => new TextDecoder().decode(buffer))
    ]);

    console.log('Files extracted successfully')

    // Process with Gemini API
    console.log('Processing with Gemini API...')
    
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY is not configured')
    }

    const genAI = new GoogleGenerativeAI(geminiApiKey)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

    console.log('Sending request to Gemini API...')
    const result = await model.generateContent(`You are an expert grading assistant. Your task is to evaluate a student's answer based on the provided question paper and grading rubric.

Question Paper:
${questionPaper}

Grading Rubric:
${gradingRubric}

Student's Answer:
${answerSheet}

Please analyze the student's answer against the question paper and grading rubric. Provide:

1. Brief Feedback (2-3 sentences): Evaluate how well the answer addresses the question requirements.
2. Key Areas for Improvement: List specific points where the answer could be enhanced based on the rubric criteria.
3. Overall Score (out of 100): Grade according to the rubric's scoring guidelines.

Format your response exactly as shown above with these three numbered sections.`)

    const response = await result.response
    const gradingResults = response.text()
    console.log('Gemini API response:', gradingResults)

    // Update session status
    await supabase
      .from('grading_sessions')
      .update({ 
        status: 'completed',
        feedback: gradingResults
      })
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
      JSON.stringify({ 
        error: error.message,
        details: error.stack
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: 500 
      }
    )
  }
})