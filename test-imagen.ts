import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function test() {
  try {
    const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: 'A futuristic house',
        config: {
            numberOfImages: 1,
            outputMimeType: 'image/jpeg',
            aspectRatio: '16:9'
        }
    });

    for (const generatedImage of response.generatedImages) {
        console.log("Got image, base64 length:", generatedImage.image.imageBytes.length);
    }
  } catch (err) {
    console.error(err);
  }
}

test();
