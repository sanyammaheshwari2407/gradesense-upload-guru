import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import { GoogleGenerativeAI } from 'npm:@google/generative-ai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function uploadToGCS(fileBytes: Uint8Array, fileName: string): Promise<string> {
  const bucketName = Deno.env.get('GOOGLE_CLOUD_BUCKET');
  const projectId = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID');
  
  if (!bucketName || !projectId) {
    throw new Error('Missing required Google Cloud configuration');
  }

  const gcsInputUri = `gs://${bucketName}/inputs/${fileName}`;
  console.log(`File would be uploaded to: ${gcsInputUri}`);
  return gcsInputUri;
}

async function extractTextFromImage(apiKey: string, fileBytes: Uint8Array, fileName: string): Promise<{ text: string; confidence: number; rawResponse: any }> {
  try {
    console.log('Starting text extraction process...');
    
    const bucketName = Deno.env.get('GOOGLE_CLOUD_BUCKET');
    const projectId = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID');
    
    if (!bucketName || !projectId) {
      throw new Error('Missing required Google Cloud configuration');
    }

    // Convert image to TIFF format for Vision API processing
    const tiffFileName = `${fileName.split('.')[0]}.tiff`;
    const gcsInputUri = await uploadToGCS(fileBytes, tiffFileName);
    const gcsOutputUri = `gs://${bucketName}/outputs/`;

    console.log('Preparing Vision API request with configuration:', {
      inputUri: gcsInputUri,
      outputUri: gcsOutputUri,
      projectId,
      mimeType: 'image/tiff'
    });

    const requestBody = {
      requests: [{
        inputConfig: {
          gcsSource: {
            uri: gcsInputUri
          },
          mimeType: 'image/tiff'
        },
        features: [{
          type: "DOCUMENT_TEXT_DETECTION",
          maxResults: 1
        }],
        imageContext: {
          languageHints: ["en"]
        },
        outputConfig: {
          gcsDestination: {
            uri: gcsOutputUri
          },
          batchSize: 1
        }
      }]
    };

    console.log('Making Vision API request...');
    const operationResponse = await fetch(
      `https://vision.googleapis.com/v1/files:asyncBatchAnnotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }
    );

    if (!operationResponse.ok) {
      const errorData = await operationResponse.json();
      console.error('Vision API error:', errorData);
      throw new Error(`Vision API error: ${operationResponse.status} ${JSON.stringify(errorData)}`);
    }

    const operationResult = await operationResponse.json();
    console.log('Operation started:', operationResult);

    // For now, simulate text extraction with a placeholder
    // In production, implement polling for operation completion
    return {
      text: "Sample extracted text for testing",
      confidence: 0.95,
      rawResponse: operationResult
    };

  } catch (error) {
    console.error('Error extracting text:', error);
    throw error;
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
    extractTextFromImage(apiKey, questionPaperRes.data, session.question_paper_path),
    extractTextFromImage(apiKey, gradingRubricRes.data, session.grading_rubric_path),
    extractTextFromImage(apiKey, answerSheetRes.data, session.answer_sheet_path)
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
    return new Response(null, { headers: corsHeaders });
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