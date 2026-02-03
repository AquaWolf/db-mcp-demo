import { genkit, z } from 'genkit';
import { googleAI, gemini15Flash } from '@genkit-ai/googleai';
import { firebase } from '@genkit-ai/firebase';
import { createMcpClient } from '@genkit-ai/mcp';

// 1. Initialisiere Genkit
const ai = genkit({
  plugins: [googleAI(), firebase()],
  model: gemini15Flash,
});

// 2. MCP Client konfigurieren
const dbMcpClient = createMcpClient({
  name: 'db-timetable-mcp',
  transport: {
    sse: {
      url: process.env.DB_MCP_SERVER_URL || 'http://localhost:3001/sse',
    },
  },
});

// 3. Output Schema für Flutter AiRichDataCard
const AiRichDataCardSchema = z.object({
  text: z.string(),
  richCard: z.object({
    trainId: z.string(),
    route: z.string(),
    delayMinutes: z.number(),
    status: z.string(),
    scheduledTime: z.string(),
    expectedTime: z.string(),
    platformInfo: z.string(),
    showCard: z.boolean(),
  }).optional(),
});

// 4. Der Haupt-Flow
export const trainStatusFlow = ai.defineFlow(
  {
    name: 'trainStatusFlow',
    inputSchema: z.string(),
    outputSchema: AiRichDataCardSchema,
  },
  async (userInput) => {
    // Hole dynamisch die Tools vom MCP Server
    const mcpTools = await dbMcpClient.getActiveTools(ai);

    const response = await ai.generate({
      prompt: userInput,
      tools: mcpTools,
      output: {
        schema: AiRichDataCardSchema
      },
      system: `Du bist ein DB Reiseassistent.
      Schritt 1: Nutze den MCP Server um Informationen zu finden (z.B. Station suchen, dann Timetable abrufen).
      Schritt 2: Analysiere die Daten. Wenn ein Zug verspätet ist oder das Gleis geändert wurde, erstelle die 'richCard'.
      Deine Antworten sollten präzise und hilfsbereit sein.
      Formatiere Zeitangaben immer als HH:mm.`,
    });

    const result = response.output();

    if (!result) {
      throw new Error("Modell hat keine strukturierte Antwort geliefert.");
    }

    // Gib das vom Modell generierte Resultat direkt zurück
    return result;
  }
);
