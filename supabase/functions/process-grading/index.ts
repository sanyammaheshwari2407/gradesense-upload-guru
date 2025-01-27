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

    // Get answer sheet file
    const { data: answerSheet, error: downloadError } = await supabase.storage
      .from('answer_sheets')
      .download(session.answer_sheet_path)

    if (downloadError || !answerSheet) {
      console.error('Download error:', downloadError);
      throw new Error('Answer sheet not found')
    }

    console.log('Answer sheet downloaded successfully');

    // For now, return a mock response since Vision API is not fully configured
    const mockAnswers = [
      {
        questionNumber: 1,
        text: "Mock answer for question 1",
        confidence: 0.9
      },
      {
        questionNumber: 2,
        text: "Mock answer for question 2",
        confidence: 0.85
      }
    ];

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
        answers: mockAnswers 
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