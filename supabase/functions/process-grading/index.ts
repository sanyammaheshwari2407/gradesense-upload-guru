import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import { GoogleGenerativeAI } from 'npm:@google/generative-ai'
import vision from 'npm:@google-cloud/vision'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const truncateText = (text: string, maxLength = 2000) => {
  return text.length > maxLength ? text.substring(0, maxLength) + "..." : text;
};

async function extractTextFromPDF(client: vision.ImageAnnotatorClient, pdfBytes: Uint8Array): Promise<string> {
  const [result] = await client.documentTextDetection({
    image: { content: Buffer.from(pdfBytes).toString('base64') }
  });
  
  return result.fullTextAnnotation?.text || '';
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

    // Initialize Vision API client
    const visionClient = new vision.ImageAnnotatorClient({
      credentials: {
        client_email: 'your-service-account@your-project.iam.gserviceaccount.com',
        private_key: Deno.env.get('GOOGLE_VISION_API_KEY')!,
      },
    });

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

    // Extract text from all documents using Vision API
    console.log('Extracting text from documents...')
    const [questionPaperText, gradingRubricText, answerSheetText] = await Promise.all([
      extractTextFromPDF(visionClient, questionPaperRes.data),
      extractTextFromPDF(visionClient, gradingRubricRes.data),
      extractTextFromPDF(visionClient, answerSheetRes.data)
    ]);

    // Store extracted text in database
    console.log('Storing extracted text...')
    const { error: extractedTextError } = await supabase
      .from('extracted_texts')
      .insert({
        grading_session_id: sessionId,
        question_paper_text: questionPaperText,
        grading_rubric_text: gradingRubricText,
        answer_sheet_text: answerSheetText
      });

    if (extractedTextError) {
      throw new Error(`Failed to store extracted text: ${extractedTextError.message}`);
    }

    // Process with Gemini API
    console.log('Processing with Gemini API...')
    
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY is not configured')
    }

    const genAI = new GoogleGenerativeAI(geminiApiKey)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

    // Truncate texts to avoid token limit issues
    const truncatedQuestionPaper = truncateText(questionPaperText);
    const truncatedGradingRubric = truncateText(gradingRubricText);
    const truncatedAnswerSheet = truncateText(answerSheetText);

    console.log('Sending request to Gemini API...')
    const result = await model.generateContent(`You are an expert grading assistant. Your task is to evaluate a student's answer based on the provided question paper and grading rubric.

Question Paper:
${truncatedQuestionPaper}

Grading Rubric:
${truncatedGradingRubric}

Student's Answer:
${truncatedAnswerSheet}

Please analyze the student's answer against the question paper and grading rubric. Provide:

1. Brief Feedback (2-3 sentences): Evaluate how well the answer addresses the question requirements.
2. Key Areas for Improvement: List specific points where the answer could be enhanced based on the rubric criteria.
3. Overall Score (out of 100): Grade according to the rubric's scoring guidelines.

Format your response exactly as shown above with these three numbered sections.`)

    const response = await result.response
    const gradingResults = response.text()
    console.log('Gemini API response:', gradingResults)

    // Update session status and feedback
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