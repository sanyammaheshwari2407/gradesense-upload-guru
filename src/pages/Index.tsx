import { useState } from "react";
import { FileUpload } from "@/components/FileUpload";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const [questionPaper, setQuestionPaper] = useState<File | null>(null);
  const [gradingRubric, setGradingRubric] = useState<File | null>(null);
  const [answerSheet, setAnswerSheet] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const uploadFile = async (file: File, bucket: string) => {
    const fileExt = file.name.split('.').pop();
    const filePath = `${crypto.randomUUID()}.${fileExt}`;
    
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, file);

    if (uploadError) {
      throw new Error(`Error uploading ${bucket}: ${uploadError.message}`);
    }

    return filePath;
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
      // Upload files to respective buckets
      const [questionPaperPath, gradingRubricPath, answerSheetPath] = await Promise.all([
        uploadFile(questionPaper, 'question_papers'),
        uploadFile(gradingRubric, 'grading_rubrics'),
        uploadFile(answerSheet, 'answer_sheets'),
      ]);

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Create grading session
      const { data: session, error: sessionError } = await supabase
        .from('grading_sessions')
        .insert({
          user_id: user.id,
          question_paper_path: questionPaperPath,
          grading_rubric_path: gradingRubricPath,
          answer_sheet_path: answerSheetPath,
          status: 'pending'
        })
        .select()
        .single();

      if (sessionError || !session) {
        throw sessionError || new Error('Failed to create grading session');
      }

      // Start processing
      const { error: processingError } = await supabase.functions
        .invoke('process-grading', {
          body: { sessionId: session.id },
        });

      if (processingError) throw processingError;

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