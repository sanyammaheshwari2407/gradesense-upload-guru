import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { GradingFeedback } from "@/components/GradingFeedback";
import { GradingForm } from "@/components/GradingForm";

const Index = () => {
  const navigate = useNavigate();
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

  const handleSubmit = async (files: {
    questionPaper: File;
    gradingRubric: File;
    answerSheet: File;
    additionalFile?: File;
  }) => {
    setIsProcessing(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        navigate('/auth');
        return;
      }

      console.log("Starting file uploads...");
      
      const uploadPromises = [
        uploadFile(files.questionPaper, 'question_papers'),
        uploadFile(files.gradingRubric, 'grading_rubrics'),
        uploadFile(files.answerSheet, 'answer_sheets'),
      ];

      if (files.additionalFile) {
        uploadPromises.push(uploadFile(files.additionalFile, 'additional_files'));
      }

      const [
        questionPaperPath,
        gradingRubricPath,
        answerSheetPath,
        additionalFilePath,
      ] = await Promise.all(uploadPromises);

      console.log("Files uploaded successfully, creating grading session...");
      
      const { data: session, error: sessionError } = await supabase
        .from('grading_sessions')
        .insert({
          question_paper_path: questionPaperPath,
          grading_rubric_path: gradingRubricPath,
          answer_sheet_path: answerSheetPath,
          additional_file_path: additionalFilePath,
          status: 'pending',
          user_id: user.id
        })
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

      if (gradingResponse?.results) {
        setFeedback(gradingResponse.results);
        setShowFeedback(true);

        await supabase
          .from('grading_sessions')
          .update({ 
            feedback: gradingResponse.results,
            status: 'completed'
          })
          .eq('id', session.id);
      }

      toast({
        title: "Grading completed",
        description: "Your files have been processed successfully.",
      });
      
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

        <GradingFeedback feedback={feedback || ""} visible={showFeedback} />
        <GradingForm onSubmit={handleSubmit} isProcessing={isProcessing} />
      </div>
    </div>
  );
};

export default Index;