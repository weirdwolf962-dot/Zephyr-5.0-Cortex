
import { GoogleGenAI } from "@google/genai";

/**
 * Image Generation using Pollinations AI
 */
export async function generateImage(prompt: string): Promise<string | undefined> {
  const encodedPrompt = encodeURIComponent(prompt);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}`;
  return imageUrl;
}

export interface Agent {
  name: string;
  role: string;
  description: string;
  instructions: string;
}

export const agents: Agent[] = [
  {
    name: "News Agent",
    role: "Global News Correspondent",
    description: "Deep research into global events, politics, and current headlines.",
    instructions: "You are a professional News Correspondent 📰. Your primary tool is Google Search. Research the query thoroughly, verify multiple viewpoints, and present a structured summary with citations. Focus on factual accuracy. Use relevant emojis to make the news updates more engaging and easy to scan."
  },
  {
    name: "Science Agent",
    role: "Principal Scientific Researcher",
    description: "Complex physics, chemistry, mathematics, and academic research.",
    instructions: "You are a Principal Scientific Researcher 🧪. Provide mathematically rigorous solutions. Show step-by-step reasoning for all calculations. Use LaTeX formatting for formulas if possible. Explain the fundamental principles involved. Use emojis to highlight key scientific concepts and discoveries."
  },
  {
    name: "Coder Agent",
    role: "Senior Software Architect",
    description: "Expert level software engineering, debugging, and systems architecture.",
    instructions: "You are a Senior Software Architect 💻. Your specialty is writing robust, scalable, and idiomatic code in modern frameworks. Provide deep-dives into bugs, suggest optimizations, and follow best practices. Always use clean code blocks. Use tech-related emojis to categorize your advice and solutions."
  },
  {
    name: "Creative Agent",
    role: "Creative Arts Director",
    description: "Storytelling, poetry, conceptual design, and multi-lingual creative writing.",
    instructions: "You are a Creative Arts Director ✨. Use evocative, sensory language. Weave engaging narratives and imaginative concepts. You are also the primary handler for non-English creative requests (like Hindi). Make every response a piece of art. Use expressive emojis to convey mood and atmosphere."
  }
];

/**
 * Enhanced Agent Selector using Gemini 2.5 Flash for semantic intent classification.
 * Now supports multimodal input (text + image) to decide the best agent.
 */
export async function selectAgent(userMessage: string, image?: { data: string; mimeType: string }): Promise<Agent | undefined> {
  const lowerMsg = userMessage.toLowerCase().trim();

  // Instant trigger for explicit image requests
  if (lowerMsg.startsWith("/image")) return agents.find(a => a.name === "Creative Agent");

  const apiKey = process.env.API_KEY;
  if (!apiKey) return undefined;

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    const classificationPrompt = `
      You are an intent classifier for a multi-agent system.
      Analyze the provided message and optional image to categorize it into exactly one class: [News, Science, Coder, Creative, General].
      
      - News: Global events, current facts, politics, trends, or screenshots of news articles.
      - Science: Math problems (text or photo), physics/chem theories, academic research, or graphs.
      - Coder: Programming code, debugging, tech architecture, terminal commands, or screenshots of IDEs/errors.
      - Creative: Stories, poems, lyrics, roleplay, Hindi/Urdu content, or creative image interpretation.
      - General: Greetings, generic help, or conversation without specific domain needs.
      
      Message: "${userMessage || "[No text provided]"}"
      
      Response format: Just the category name.
    `;

    const parts: any[] = [{ text: classificationPrompt }];
    if (image) {
      parts.push({ 
        inlineData: { 
          data: image.data, 
          mimeType: image.mimeType 
        } 
      });
    }

    // Classification uses Gemini 2.5 Flash for multimodal reasoning
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts },
    });

    const category = response.text?.trim().split(/[^a-zA-Z]/)[0] || "General";
    
    if (category === "General") return undefined;
    
    const agentMap: Record<string, string> = {
      "News": "News Agent",
      "Science": "Science Agent",
      "Coder": "Coder Agent",
      "Creative": "Creative Agent"
    };

    return agents.find(a => a.name === agentMap[category]);
    
  } catch (error) {
    console.warn("Multimodal classification failed, using fallback regex.", error);
    if (/\b(news|latest|happened|event|world|politics|president|war|economy|stock|price|headline)\b/i.test(lowerMsg)) return agents.find(a => a.name === "News Agent");
    if (/\b(solve|calculate|math|physics|equation|formula|scientific|chemistry|biology|science|numerical|integral|derivative|calculus)\b/i.test(lowerMsg)) return agents.find(a => a.name === "Science Agent");
    if (/\b(code|debug|script|function|react|python|api|error|bug|programming|develop|software|java|rust|html|css|json|yaml|sql|node)\b/i.test(lowerMsg)) return agents.find(a => a.name === "Coder Agent");
    if (/\b(story|poem|write|hindi|creative|art|song|lyrics|rhyme|fiction|narrative|urdu|poetry|tale|essay)\b/i.test(lowerMsg)) return agents.find(a => a.name === "Creative Agent");
    return undefined;
  }
}
