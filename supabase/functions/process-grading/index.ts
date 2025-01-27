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
    console.log('Processing grading request...');
    const { sessionId } = await req.json()
    console.log('Session ID:', sessionId);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    console.log('Fetching session details...');
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

    // Download all necessary files
    const [answerSheet, questionPaper, gradingRubric] = await Promise.all([
      supabase.storage.from('answer_sheets').download(session.answer_sheet_path),
      supabase.storage.from('question_papers').download(session.question_paper_path),
      supabase.storage.from('grading_rubrics').download(session.grading_rubric_path)
    ]);

    if (!answerSheet.data || !questionPaper.data || !gradingRubric.data) {
      throw new Error('Failed to download one or more files');
    }

    console.log('All files downloaded successfully');

    // Convert files to base64 for Vision API
    const answerSheetBase64 = await answerSheet.data.arrayBuffer()
      .then(buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))));

    // Call Google Vision API
    const visionApiKey = Deno.env.get('GOOGLE_VISION_API_KEY')!;
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
    );

    const visionData = await visionResponse.json();
    console.log('Vision API response received');

    if (!visionData.responses?.[0]?.fullTextAnnotation?.text) {
      throw new Error('Failed to extract text from answer sheet');
    }

    const extractedText = visionData.responses[0].fullTextAnnotation.text;
    console.log('Extracted text from answer sheet:', extractedText);

    // Process question paper and grading rubric
    // For now, we'll use mock grading logic
    const answers = [
      {
        questionNumber: 1,
        text: extractedText.substring(0, 200), // First 200 chars as answer 1
        confidence: 0.9,
        score: 8,
        maxScore: 10,
        feedback: "Good attempt, but missing some key points"
      },
      {
        questionNumber: 2,
        text: extractedText.substring(200, 400), // Next 200 chars as answer 2
        confidence: 0.85,
        score: 7,
        maxScore: 10,
        feedback: "Partial understanding demonstrated"
      }
    ];

    console.log('Grading completed, answers:', answers);

    // Update session status
    const { error: updateError } = await supabase
      .from('grading_sessions')
      .update({ status: 'completed' })
      .eq('id', sessionId);

    if (updateError) {
      console.error('Update error:', updateError);
      throw updateError;
    }

    console.log('Session status updated to completed');
    console.log('Sending response with graded answers');

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
    );

  } catch (error) {
    console.error('Error processing grading:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});