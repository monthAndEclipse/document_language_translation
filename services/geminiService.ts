import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | null = null;

const getClient = () => {
  if (!client) {
    const apiKey = process.env.API_KEY || '';
    client = new GoogleGenAI({ apiKey });
  }
  return client;
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const translateTextSegment = async (
  text: string,
  targetLang: string
): Promise<string> => {
  if (!text || text.trim().length === 0) return text;
  
  const MAX_RETRIES = 5;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      const ai = getClient();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Translate the following text into ${targetLang}.
        
        IMPORTANT INSTRUCTIONS:
        1. The text may consist of multiple segments separated by the delimiter " ||| ".
        2. You MUST output the translated segments separated by the SAME delimiter " ||| ".
        3. Do NOT add any introductory text, notes, or explanations.
        4. Do NOT wrap the output in quotes.
        5. Preserve the original tone, formatting, and whitespace.
        
        Text to translate:
        ${text}`,
        config: {
          maxOutputTokens: 8192,
          temperature: 0.1, 
        }
      });

      return response.text?.trim() || text;
    } catch (error: any) {
      // Check for 429 (Too Many Requests/Resource Exhausted) or 503 (Service Unavailable)
      const errorCode = error?.status || error?.response?.status || error?.body?.error?.code;
      const errorMessage = error?.message || JSON.stringify(error);
      
      const isRateLimit = errorCode === 429 || errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED');
      const isServerOverload = errorCode === 503 || errorMessage.includes('503');

      if ((isRateLimit || isServerOverload) && attempt < MAX_RETRIES - 1) {
        // Deep Geometric Backoff: 
        // 10s -> 20s -> 40s -> 80s...
        // This is necessary if the user has completely exhausted the quota bucket.
        const backoffTime = (10000 * Math.pow(2, attempt)) + (Math.random() * 2000);
        console.warn(`Translation API rate limited. Retrying in ${Math.round(backoffTime/1000)}s... (Attempt ${attempt + 1}/${MAX_RETRIES})`);
        await delay(backoffTime);
        attempt++;
        continue;
      }

      console.error("Gemini API Error:", error);
      throw error;
    }
  }
  
  throw new Error("Max retries exceeded for translation request.");
};
