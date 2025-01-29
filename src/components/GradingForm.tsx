import { useState } from "react";
import { FileUpload } from "@/components/FileUpload";
import { Button } from "@/components/ui/button";

interface GradingFormProps {
  onSubmit: (files: {
    questionPaper: File;
    gradingRubric: File;
    answerSheet: File;
  }) => Promise<void>;
  isProcessing: boolean;
}

export const GradingForm = ({ onSubmit, isProcessing }: GradingFormProps) => {
  const [questionPaper, setQuestionPaper] = useState<File | null>(null);
  const [gradingRubric, setGradingRubric] = useState<File | null>(null);
  const [answerSheet, setAnswerSheet] = useState<File | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!questionPaper || !gradingRubric || !answerSheet) return;

    await onSubmit({
      questionPaper,
      gradingRubric,
      answerSheet,
    });

    // Reset form after submission
    setQuestionPaper(null);
    setGradingRubric(null);
    setAnswerSheet(null);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white p-8 rounded-xl shadow-sm">
      <FileUpload
        label="Question Paper (Image)"
        accept=".jpg,.jpeg,.png"
        onChange={setQuestionPaper}
      />
      <FileUpload
        label="Grading Rubric (Image)"
        accept=".jpg,.jpeg,.png"
        onChange={setGradingRubric}
      />
      <FileUpload
        label="Handwritten Answer Sheet (Image)"
        accept=".jpg,.jpeg,.png"
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
  );
};