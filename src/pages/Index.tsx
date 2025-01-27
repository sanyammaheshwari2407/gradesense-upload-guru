import { useState } from "react";
import { FileUpload } from "@/components/FileUpload";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

const Index = () => {
  const [questionPaper, setQuestionPaper] = useState<File | null>(null);
  const [gradingRubric, setGradingRubric] = useState<File | null>(null);
  const [answerSheet, setAnswerSheet] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

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
      // Check if user is authenticated
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast({
          title: "Authentication required",
          description: "Please log in to process files.",
          variant: "destructive",
        });
        return;
      }

      console.log("Starting file uploads...");
      
      // Upload files to respective buckets
      const [questionPaperPath, gradingRubricPath, answerSheetPath] = await Promise.all([
        uploadFile(questionPaper, 'question_papers'),
        uploadFile(gradingRubric, 'grading_rubrics'),
        uploadFile(answerSheet, 'answer_sheets'),
      ]);

      console.log("Files uploaded successfully, creating grading session...");
      
      // Create grading session
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

      // Start processing
      const { error: processingError } = await supabase.functions
        .invoke('process-grading', {
          body: { sessionId: session.id },
        });

      if (processingError) {
        console.error("Error invoking process-grading function:", processingError);
        throw processingError;
      }

      toast({
        title: "Grading started",
        description: "Your files are being processed. You'll be notified when the grading is complete.",
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

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">GradeSense</h1>
          <p className="mt-2 text-gray-600">
            Upload your files below to start grading
          </p>
        </div>

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