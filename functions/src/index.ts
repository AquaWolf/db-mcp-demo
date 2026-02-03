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

// 3. Schema für Chat History
const MessageSchema = z.object({
  role: z.enum(['user', 'model', 'system']),
  content: z.array(z.object({ text: z.string() })),
});

// Hybrides Output Schema für Flutter
const UniversalResponseSchema = z.object({
  text: z.string(),
  responseType: z.enum(["GENERAL", "TRAIN_STATUS"]),
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

// 4. Der Hybride Flow mit History Unterstützung
export const smartAssistantFlow = ai.defineFlow(
  {
    name: 'smartAssistantFlow',
    inputSchema: z.object({
      prompt: z.string(),
      history: z.array(MessageSchema).optional(),
    }),
    outputSchema: UniversalResponseSchema,
  },
  async (input) => {
    const mcpTools = await dbMcpClient.getActiveTools(ai);

    const response = await ai.generate({
      prompt: input.prompt,
      history: input.history,
      tools: mcpTools,
      output: {
        schema: UniversalResponseSchema
      },
      system: `Du bist ein intelligenter Reisebegleiter der Deutschen Bahn.
      Du hast Zugriff auf die Chat-Historie, um den Kontext zu verstehen.
      Schritt 1: Nutze bei Bahnanfragen den MCP Server (search_station, get_timetable).
      Schritt 2: Wenn du Zugdaten lieferst, setze responseType auf 'TRAIN_STATUS' und befülle 'richCard'.
      Schritt 3: Bei allgemeinen Fragen setze responseType auf 'GENERAL'.
      Zeitformat: HH:mm.`,
    });

    const result = response.output();
    if (!result) throw new Error("Keine Antwort generiert.");

    return result;
  }
);
