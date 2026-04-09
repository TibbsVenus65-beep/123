import { GoogleGenAI, Type } from "@google/genai";
import { OCRResult, GenerationResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const geminiService = {
  async recognizeWrongQuestion(base64Image: string, mimeType: string): Promise<OCRResult> {
    const prompt = `
      You are an expert OCR and educational assistant. 
      Analyze the provided image of a wrong question.
      Extract the following information in JSON format:
      - text: The full text of the question.
      - options: An array of options (if it's a multiple choice question).
      - userAnswer: The user's original answer (if visible).
      - correctAnswer: The standard correct answer (if visible).
      - knowledgePoint: A concise name for the core knowledge point (e.g., "Quadratic Equation Discriminant", "Present Perfect Tense", "Ohm's Law").
      
      Return ONLY the JSON object.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { data: base64Image, mimeType } }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            options: { type: Type.ARRAY, items: { type: Type.STRING } },
            userAnswer: { type: Type.STRING },
            correctAnswer: { type: Type.STRING },
            knowledgePoint: { type: Type.STRING }
          },
          required: ["text", "knowledgePoint"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  },

  async generateVariations(knowledgePoint: string, originalText: string): Promise<GenerationResult> {
    const prompt = `
      Based on the knowledge point "${knowledgePoint}" and the original question: "${originalText}",
      generate 3 similar questions (举一反三).
      
      Requirements for each variation:
      - Cover the same knowledge point from different angles or transformations.
      - Difficulty should be similar to the original.
      - Provide the correct answer.
      - Provide a detailed analysis, highlighting common mistake points (易错点分析).
      
      Return the result in JSON format with:
      - knowledgePoint: The knowledge point name.
      - variations: An array of objects, each with 'text', 'answer', 'analysis', and 'commonMistakes'.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            knowledgePoint: { type: Type.STRING },
            variations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  answer: { type: Type.STRING },
                  analysis: { type: Type.STRING },
                  commonMistakes: { type: Type.STRING }
                },
                required: ["text", "answer", "analysis"]
              }
            }
          },
          required: ["knowledgePoint", "variations"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  }
};
