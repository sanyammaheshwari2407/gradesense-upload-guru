import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

interface GradingFeedbackProps {
  feedback: string;
  visible: boolean;
}

export const GradingFeedback = ({ feedback, visible }: GradingFeedbackProps) => {
  if (!visible || !feedback) return null;

  return (
    <Alert className="mb-8">
      <AlertTitle>Grading Results</AlertTitle>
      <AlertDescription>
        <div className="mt-2 space-y-4">
          {feedback.split('\n\n').map((section, index) => {
            if (!section.trim()) return null;
            return (
              <div key={index} className="space-y-2">
                {section.split('\n').map((line, lineIndex) => (
                  line.trim() && (
                    <div key={`${index}-${lineIndex}`} className="flex items-start">
                      <span className="mr-2">•</span>
                      <p className="flex-1">{line.trim().replace(/\*\*/g, '')}</p>
                    </div>
                  )
                ))}
              </div>
            );
          })}
        </div>
      </AlertDescription>
    </Alert>
  );
};