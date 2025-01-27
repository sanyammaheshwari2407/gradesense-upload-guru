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
    console.log('Processing grading request...');
    const { sessionId } = await req.json()
    console.log('Session ID:', sessionId);

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

    if (sessionError) {
      console.error('Session error:', sessionError);
      throw new Error('Session not found')
    }

    if (!session) {
      console.error('No session found');
      throw new Error('Session not found')
    }

    console.log('Session found:', session);

    // Initialize Vision API client
    const credentials = JSON.parse(Deno.env.get('GOOGLE_VISION_API_KEY') || '{}');
    const visionClient = new vision.ImageAnnotatorClient({
      credentials
    })

    // Get answer sheet file
    const { data: answerSheet, error: downloadError } = await supabase.storage
      .from('answer_sheets')
      .download(session.answer_sheet_path)

    if (downloadError || !answerSheet) {
      console.error('Download error:', downloadError);
      throw new Error('Answer sheet not found')
    }

    console.log('Answer sheet downloaded successfully');

    // Process answer sheet with Vision API
    const [result] = await visionClient.documentTextDetection(answerSheet)
    const fullText = result.fullTextAnnotation?.text || ''

    console.log('Text extracted successfully');

    // Extract questions and answers
    const answers = extractQuestionsAndAnswers(fullText)

    // Update session status
    const { error: updateError } = await supabase
      .from('grading_sessions')
      .update({ status: 'completed' })
      .eq('id', sessionId)

    if (updateError) {
      console.error('Update error:', updateError);
      throw updateError;
    }

    console.log('Grading completed successfully');

    return new Response(
      JSON.stringify({ 
        message: 'Grading completed successfully',
        answers 
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': '
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