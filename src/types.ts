export interface QuestionData {
  text: string;
  imageUrl?: string;
  options?: string[];
  userAnswer?: string;
  correctAnswer?: string;
  analysis?: string;
}

export interface Variation {
  text: string;
  answer: string;
  analysis: string;
  commonMistakes?: string;
}

export interface WrongQuestionRecord {
  id?: string;
  userId: string;
  originalQuestion: QuestionData;
  knowledgePoint: string;
  variations: Variation[];
  createdAt: string;
}

export interface OCRResult {
  text: string;
  options?: string[];
  userAnswer?: string;
  correctAnswer?: string;
  knowledgePoint: string;
}

export interface GenerationResult {
  knowledgePoint: string;
  variations: Variation[];
}
