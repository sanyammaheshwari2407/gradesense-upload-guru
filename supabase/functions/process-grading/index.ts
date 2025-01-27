import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

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

    // Download answer sheet
    console.log('Downloading answer sheet...')
    const { data: answerSheetData, error: downloadError } = await supabase.storage
      .from('answer_sheets')
      .download(session.answer_sheet_path)

    if (downloadError || !answerSheetData) {
      throw new Error('Failed to download answer sheet')
    }

    // Convert to text
    const text = await answerSheetData.text()
    console.log('Answer sheet text extracted:', text.substring(0, 100) + '...')

    // Process with Gemini API
    console.log('Processing with Gemini API...')
    
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY is not configured')
    }

    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${geminiApiKey}`
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are a grading assistant. Please analyze this student's answer and provide feedback:
              
              Student Answer:
              ${text.substring(0, 1000)} // Limit text length for MVP
              
              Please provide:
              1. Brief feedback (2-3 sentences)
              2. Key areas for improvement
              3. Overall score (out of 100)`
            }]
          }]
        })
      }
    )

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text()
      console.error('Gemini API error:', errorText)
      throw new Error(`Gemini API error: ${geminiResponse.status} ${errorText}`)
    }

    const geminiData = await geminiResponse.json()
    console.log('Gemini API raw response:', geminiData)

    if (!geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error('Invalid Gemini API response format:', geminiData)
      throw new Error('Invalid response format from Gemini API')
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