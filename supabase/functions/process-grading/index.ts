import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import vision from 'https://esm.sh/@google-cloud/vision@4.0.2'

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
    const { sessionId } = await req.json()

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Get session details
    const { data: session, error: sessionError } = await supabase
      .from('grading_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      throw new Error('Session not found')
    }

    // Initialize Vision API client
    const visionClient = new vision.ImageAnnotatorClient({
      credentials: { private_key: Deno.env.get('GOOGLE_VISION_API_KEY') }
    })

    // Get answer sheet file
    const { data: answerSheet } = await supabase.storage
      .from('answer_sheets')
      .download(session.answer_sheet_path)

    if (!answerSheet) {
      throw new Error('Answer sheet not found')
    }

    // Process answer sheet with Vision API
    const [result] = await visionClient.documentTextDetection(answerSheet)
    const fullText = result.fullTextAnnotation?.text || ''

    // Extract questions and answers
    const answers = extractQuestionsAndAnswers(fullText)

    // Store extracted answers
    for (const answer of answers) {
      await supabase.from('extracted_answers').insert({
        grading_session_id: sessionId,
        question_number: answer.questionNumber,
        extracted_text: answer.text,
        confidence_score: answer.confidence,
        needs_review: answer.confidence < 0.8
      })
    }

    // Get grading rubric
    const { data: rubric } = await supabase.storage
      .from('grading_rubrics')
      .download(session.grading_rubric_path)

    if (!rubric) {
      throw new Error('Grading rubric not found')
    }

    // Grade answers and generate feedback
    const gradingResults = await gradeAnswers(answers, rubric)

    // Store grading results
    for (const result of gradingResults) {
      await supabase.from('grading_results').insert({
        grading_session_id: sessionId,
        question_number: result.questionNumber,
        score: result.score,
        max_score: result.maxScore,
        feedback: result.feedback
      })
    }

    // Update session status
    await supabase
      .from('grading_sessions')
      .update({ status: 'completed' })
      .eq('id', sessionId)

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
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})

function extractQuestionsAndAnswers(text: string) {
  // Basic implementation - this should be enhanced based on your specific format
  const answers = []
  const lines = text.split('\n')
  let currentQuestion = null
  let currentAnswer = []

  for (const line of lines) {
    // Look for question numbers (e.g., "1.", "2.", etc.)
    const questionMatch = line.match(/^(\d+)\.\s*(.*)/)
    
    if (questionMatch) {
      // If we were building a previous answer, save it
      if (currentQuestion) {
        answers.push({
          questionNumber: currentQuestion,
          text: currentAnswer.join('\n'),
          confidence: 0.9 // This should be calculated based on Vision API confidence scores
        })
      }
      
      currentQuestion = parseInt(questionMatch[1])
      currentAnswer = [questionMatch[2]]
    } else if (currentQuestion) {
      currentAnswer.push(line)
    }
  }

  // Don't forget to add the last answer
  if (currentQuestion) {
    answers.push({
      questionNumber: currentQuestion,
      text: currentAnswer.join('\n'),
      confidence: 0.9
    })
  }

  return answers
}

async function gradeAnswers(answers: any[], rubric: any) {
  // Basic implementation - this should be enhanced based on your specific rubric format
  return answers.map(answer => ({
    questionNumber: answer.questionNumber,
    score: 8, // This should be calculated based on rubric criteria
    maxScore: 10,
    feedback: "Your answer is mostly correct, but could use more detail."
  }))
}