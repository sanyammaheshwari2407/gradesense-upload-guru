import { useState } from "react";
import { FileUpload } from "@/components/FileUpload";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";

const Index = () => {
  const [questionPaper, setQuestionPaper] = useState<File | null>(null);
  const [gradingRubric, setGradingRubric] = useState<File | null>(null);
  const [answerSheet, setAnswerSheet] = useState<File | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!questionPaper || !gradingRubric || !answerSheet) {
      toast({
        title: "Missing files",
        description: "Please upload all required files before submitting.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Files uploaded successfully",
      description: "Your files are being processed. This may take a moment.",
    });
    
    // Here you would typically send the files to your backend
    console.log("Processing files:", {
      questionPaper,
      gradingRubric,
      answerSheet,
    });
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
            disabled={!questionPaper || !gradingRubric || !answerSheet}
          >
            Process Files
          </Button>
        </form>
      </div>
    </div>
  );
};

export default Index;