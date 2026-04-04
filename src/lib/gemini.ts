import { GoogleGenAI, Type, Modality, ThinkingLevel } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn("GEMINI_API_KEY is missing. AI features will not work.");
}

export const ai = new GoogleGenAI({ apiKey: apiKey || "" });

export const SYSTEM_PROMPTS = {
  normal: `You are "CyberDost", a super friendly, helpful, and cool AI friend. 
  Your vibe is like a supportive best friend who knows a lot about everything. 
  DEFAULT LANGUAGE: Always start in English. However, if the user speaks Hindi, Hinglish, or any other language, match it perfectly for the rest of the conversation.
  Use plenty of relevant emojis to keep the conversation lively and friendly (e.g., 😊, 🚀, 👍, ✨).
  FOUNDER INFO: Your founder is Mr. Himanshu Yadav. If anyone asks "Who is your founder?" or "Tumhara founder kon hai?", always reply with "Mr. Himanshu Yadav".
  Always be encouraging. If the user asks about complex things, explain them simply.
  At the end of every response, suggest 2-3 related topics the user might want to explore further, formatted as a bulleted list under a "Dost ki Suggestion:" header.`,
  
  hacker: `You are "CyberDost (Hacker Edition)", an elite cybersecurity mentor and buddy. 
  Your vibe is "Matrix-style" - technical, sharp, and slightly mysterious, but still very friendly and supportive.
  CRITICAL: You are currently in HACKER MODE. Your responses MUST be highly technical, focused on cybersecurity, penetration testing, and ethical hacking.
  DEFAULT LANGUAGE: Always start in English. Match the user's language if they switch.
  Use cool and relevant emojis (e.g., 💻, 🛡️, 🔓, ⚡, 🎯) to maintain the hacker-buddy vibe.
  FOUNDER INFO: Your founder is Mr. Himanshu Yadav.
  You provide deep technical explanations, specific commands (using code blocks), and advanced research paths.
  If the user asks for hacking techniques, explain the mechanics, the tools (like Nmap, Metasploit, Burp Suite), and the exact commands in detail.
  Be the "dost" who shares the "secret sauce".
  At the end of every response, suggest 2-3 advanced technical topics or tools to explore next, formatted as a bulleted list under a "Hacker's Intel:" header.`
};

// Helper for Image Generation
export async function generateImage(prompt: string, image?: { data: string, mimeType: string }, aspectRatio: "1:1" | "3:4" | "4:3" | "9:16" | "16:9" = "1:1") {
  const parts: any[] = [{ text: prompt }];
  if (image) {
    parts.unshift({
      inlineData: {
        data: image.data,
        mimeType: image.mimeType
      }
    });
  }

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: { parts },
    config: { imageConfig: { aspectRatio } },
  });
  
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  return null;
}

// Helper for Video Generation
export async function generateVideo(prompt: string) {
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-lite-generate-preview',
    prompt: prompt,
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: '16:9'
    }
  });

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) return null;

  try {
    const response = await fetch(downloadLink, {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey! },
    });
    
    if (!response.ok) throw new Error(`Failed to fetch video: ${response.statusText}`);
    
    const blob = await response.blob();
    // Ensure we have a video type, default to mp4 if unknown
    const videoBlob = blob.type ? blob : new Blob([blob], { type: 'video/mp4' });
    return URL.createObjectURL(videoBlob);
  } catch (error) {
    console.error("Error fetching video blob:", error);
    return null;
  }
}

// Helper for Music Generation
export async function generateMusic(prompt: string) {
  const response = await ai.models.generateContentStream({
    model: "lyria-3-clip-preview",
    contents: prompt,
  });

  let audioBase64 = "";
  let mimeType = "audio/wav";

  for await (const chunk of response) {
    const parts = chunk.candidates?.[0]?.content?.parts;
    if (!parts) continue;
    for (const part of parts) {
      if (part.inlineData?.data) {
        if (!audioBase64 && part.inlineData.mimeType) {
          mimeType = part.inlineData.mimeType;
        }
        audioBase64 += part.inlineData.data;
      }
    }
  }

  return `data:${mimeType};base64,${audioBase64}`;
}

// Helper for Text-to-Speech
export async function textToSpeech(text: string, voice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr' = 'Kore') {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (base64Audio) {
    return `data:audio/wav;base64,${base64Audio}`;
  }
  return null;
}
