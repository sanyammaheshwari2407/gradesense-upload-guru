import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import { GoogleGenerativeAI } from 'npm:@google/generative-ai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function uploadToGCS(fileBytes: Uint8Array, fileName: string, mimeType: string): Promise<string> {
  const bucketName = Deno.env.get('GOOGLE_CLOUD_BUCKET')!;
  const gcsInputUri = `gs://${bucketName}/inputs/${fileName}`;
  
  // Implementation of GCS upload will go here
  // For now, we'll use the direct Vision API approach
  return gcsInputUri;
}

async function extractTextFromImage(apiKey: string, fileBytes: Uint8Array): Promise<{ text: string; confidence: number; rawResponse: any }> {
  try {
    console.log('Starting text extraction from image...');
    
    // Convert Uint8Array to base64
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(fileBytes)));
    
    const visionRequest = {
      requests: [{
        image: {
          content: base64Image
        },
        features: [{
          type: "DOCUMENT_TEXT_DETECTION",
          maxResults: 1
        }],
        imageContext: {
          languageHints: ["en"]
        }
      }]
    };

    console.log('Sending request to Vision API...');
    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(visionRequest)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Vision API error:', errorData);
      throw new Error(`Vision API error: ${response.status} ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    console.log('Vision API response received');

    const firstResponse = result.responses?.[0];
    if (!firstResponse) {
      throw new Error('No response data from Vision API');
    }

    const fullTextAnnotation = firstResponse.fullTextAnnotation;
    const text = fullTextAnnotation?.text || '';
    
    const confidence = fullTextAnnotation?.pages?.reduce((acc: number, page: any) => 
      acc + (page.confidence || 0), 0) / (fullTextAnnotation?.pages?.length || 1);

    return {
      text,
      confidence,
      rawResponse: result
    };
  } catch (error) {
    console.error('Error extracting text:', error);
    throw new Error(`Failed to extract text: ${error.message}`);
  }
}

async function processGradingSession(supabase: any, sessionId: string, apiKey: string) {
  console.log('Processing grading session:', sessionId);
  
  const { data: session, error: sessionError } = await supabase
    .from('grading_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (sessionError) throw new Error(`Session not found: ${sessionError.message}`);

  // Download files
  const [questionPaperRes, gradingRubricRes, answerSheetRes] = await Promise.all([
    supabase.storage.from('question_papers').download(session.question_paper_path),
    supabase.storage.from('grading_rubrics').download(session.grading_rubric_path),
    supabase.storage.from('answer_sheets').download(session.answer_sheet_path)
  ]);

  // Process each document with Vision API
  const [questionPaper, gradingRubric, answerSheet] = await Promise.all([
    extractTextFromImage(apiKey, questionPaperRes.data),
    extractTextFromImage(apiKey, gradingRubricRes.data),
    extractTextFromImage(apiKey, answerSheetRes.data)
  ]);

  // Store extracted texts with Vision API responses
  await supabase
    .from('extracted_texts')
    .insert({
      grading_session_id: sessionId,
      question_paper_text: questionPaper.text,
      grading_rubric_text: gradingRubric.text,
      answer_sheet_text: answerSheet.text,
      vision_api_response: {
        questionPaper: questionPaper.rawResponse,
        gradingRubric: gradingRubric.rawResponse,
        answerSheet: answerSheet.rawResponse
      },
      confidence_score: (questionPaper.confidence + gradingRubric.confidence + answerSheet.confidence) / 3
    });

  return {
    questionPaper: questionPaper.text,
    gradingRubric: gradingRubric.text,
    answerSheet: answerSheet.text
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { sessionId } = await req.json();
    console.log('Processing request for session:', sessionId);

    if (!sessionId) {
      throw new Error('No session ID provided');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const googleApiKey = Deno.env.get('GOOGLE_API_KEY');

    if (!supabaseUrl || !supabaseKey || !googleApiKey) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Process the grading session
    const extractedTexts = await processGradingSession(supabase, sessionId, googleApiKey);

    // Initialize Gemini AI
    const genAI = new GoogleGenerativeAI(googleApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Generate grading feedback
    const result = await model.generateContent(`
      You are an expert grading assistant. Grade this answer based on:

      Question Paper:
      ${extractedTexts.questionPaper}

      Grading Rubric:
      ${extractedTexts.gradingRubric}

      Student's Answer:
      ${extractedTexts.answerSheet}

      Provide:
      1. Brief Feedback (2-3 sentences)
      2. Key Areas for Improvement (bullet points)
      3. Overall Score (out of 100)
    `);

    const gradingResults = result.response.text();

    // Update session with feedback
    await supabase
      .from('grading_sessions')
      .update({ 
        status: 'completed',
        feedback: gradingResults
      })
      .eq('id', sessionId);

    return new Response(
      JSON.stringify({
        message: 'Grading completed successfully',
        results: gradingResults
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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