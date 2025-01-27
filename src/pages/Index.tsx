import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FileUpload } from "@/components/FileUpload";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

const Index = () => {
  const navigate = useNavigate();
  const [questionPaper, setQuestionPaper] = useState<File | null>(null);
  const [gradingRubric, setGradingRubric] = useState<File | null>(null);
  const [answerSheet, setAnswerSheet] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/auth');
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      navigate('/auth');
    } finally {
      setIsLoading(false);
    }
  };

  const uploadFile = async (file: File, bucket: string) => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${crypto.randomUUID()}.${fileExt}`;
    
    const { data, error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(fileName, file);

    if (uploadError) {
      console.error(`Error uploading to ${bucket}:`, uploadError);
      throw new Error(`Error uploading ${bucket}: ${uploadError.message}`);
    }

    if (!data?.path) {
      throw new Error(`No path returned from ${bucket} upload`);
    }

    return data.path;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!questionPaper || !gradingRubric || !answerSheet) {
      toast({
        title: "Missing files",
        description: "Please upload all required files before submitting.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        navigate('/auth');
        return;
      }

      console.log("Starting file uploads...");
      
      const [questionPaperPath, gradingRubricPath, answerSheetPath] = await Promise.all([
        uploadFile(questionPaper, 'question_papers'),
        uploadFile(gradingRubric, 'grading_rubrics'),
        uploadFile(answerSheet, 'answer_sheets'),
      ]);

      console.log("Files uploaded successfully, creating grading session...");
      
      const { data: session, error: sessionError } = await supabase
        .from('grading_sessions')
        .insert({
          question_paper_path: questionPaperPath,
          grading_rubric_path: gradingRubricPath,
          answer_sheet_path: answerSheetPath,
          status: 'pending',
          user_id: user.id
        } satisfies Database['public']['Tables']['grading_sessions']['Insert'])
        .select()
        .single();

      if (sessionError) {
        console.error("Error creating grading session:", sessionError);
        throw sessionError;
      }

      if (!session) {
        throw new Error('Failed to create grading session');
      }

      console.log("Grading session created successfully:", session);

      const { data: gradingResponse, error: processingError } = await supabase.functions
        .invoke('process-grading', {
          body: { sessionId: session.id },
        });

      if (processingError) {
        console.error("Error invoking process-grading function:", processingError);
        throw processingError;
      }

      console.log("Grading response received:", gradingResponse);

      // Fetch the updated session to get the feedback
      const { data: updatedSession, error: fetchError } = await supabase
        .from('grading_sessions')
        .select('feedback')
        .eq('id', session.id)
        .single();

      if (fetchError) {
        throw fetchError;
      }

      if (updatedSession?.feedback) {
        setFeedback(updatedSession.feedback);
        setShowFeedback(true);
      }

      toast({
        title: "Grading completed",
        description: "Your files have been processed successfully.",
      });

      // Reset form
      setQuestionPaper(null);
      setGradingRubric(null);
      setAnswerSheet(null);
      
    } catch (error) {
      console.error('Error processing files:', error);
      toast({
        title: "Error",
        description: "An error occurred while processing the files. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">GradeSense</h1>
          <p className="mt-2 text-gray-600">
            Upload your files below to start grading
          </p>
        </div>

        {showFeedback && feedback && (
          <Alert className="mb-8">
            <AlertTitle>Grading Feedback</AlertTitle>
            <AlertDescription>
              <div className="mt-2 space-y-2">
                {feedback.split('\n').map((point, index) => (
                  point.trim() && (
                    <div key={index} className="flex items-start">
                      <span className="mr-2">•</span>
                      <p>{point.trim()}</p>
                    </div>
                  )
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 bg-white p-8 rounded-xl shadow-sm">
          <FileUpload
            label="Question Paper"
            accept=".pdf,.docx"
            onChange={setQuestionPaper}
          />
          <FileUpload
            label="Grading Rubric"
            accept=".pdf,.docx"
            onChange={setGradingRubric}
          />
          <FileUpload
            label="Handwritten Answer Sheet"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={setAnswerSheet}
          />
          
          <Button
            type="submit"
            className="w-full"
            disabled={!questionPaper || !gradingRubric || !answerSheet || isProcessing}
          >
            {isProcessing ? "Processing..." : "Process Files"}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default Index;