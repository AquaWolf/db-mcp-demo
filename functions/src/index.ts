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

// 3. Hybrides Output Schema für Flutter (Universal Response)
const UniversalResponseSchema = z.object({
  text: z.string().describe("Die Antwort des Assistenten (Textform)"),
  responseType: z.enum(["GENERAL", "TRAIN_STATUS"]).describe("Gibt an, ob eine Rich Card angezeigt werden soll"),
  richCard: z.object({
    trainId: z.string(),
    route: z.string(),
    delayMinutes: z.number(),
    status: z.string(),
    scheduledTime: z.string(),
    expectedTime: z.string(),
    platformInfo: z.string(),
    showCard: z.boolean(),
  }).optional().describe("Daten für das AiRichDataCard Widget in Flutter"),
});

// 4. Der Hybride Flow
export const smartAssistantFlow = ai.defineFlow(
  {
    name: 'smartAssistantFlow',
    inputSchema: z.string(),
    outputSchema: UniversalResponseSchema,
  },
  async (userInput) => {
    // Hole dynamisch die Tools vom MCP Server
    const mcpTools = await dbMcpClient.getActiveTools(ai);

    const response = await ai.generate({
      prompt: userInput,
      tools: mcpTools,
      output: {
        schema: UniversalResponseSchema
      },
      system: `Du bist ein intelligenter Reisebegleiter.
      Schritt 1: Entscheide, ob der User eine Bahnauskunft möchte oder eine allgemeine Frage stellt.
      Schritt 2: Bei Bahnanfragen nutze den MCP Server (search_station, get_timetable).
      Schritt 3: Wenn du Zugdaten lieferst, setze responseType auf 'TRAIN_STATUS' und befülle 'richCard'.
      Schritt 4: Bei allen anderen Fragen antworte freundlich, setze responseType auf 'GENERAL' und lasse 'richCard' weg.
      Zeitformat: HH:mm.`,
    });

    const result = response.output();
    if (!result) {
      throw new Error("Keine Antwort vom Modell generiert.");
    }

    return result;
  }
);
