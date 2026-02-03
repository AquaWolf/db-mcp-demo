import { genkit, z } from 'genkit';
import { googleAI, gemini15Flash } from '@genkit-ai/googleai';
import { firebase } from '@genkit-ai/firebase';
import { createMcpClient } from '@genkit-ai/mcp';
import { onCallGenkit } from 'firebase-functions/v2/https';

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

// 3. Schema Definitionen
const MessageSchema = z.object({
  role: z.enum(['user', 'model', 'system']),
  content: z.array(z.object({ text: z.string() })),
});

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

// 4. Der Haupt-Flow
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
      output: { schema: UniversalResponseSchema },
      system: `Du bist ein DB Reiseassistent. Nutze den MCP Server.`,
    });

    const result = response.output();
    if (!result) throw new Error("No output generated");
    return result;
  }
);

// 5. Firebase Cloud Function mit Autorisierung exposen
// Diese Funktion prüft automatisch den Firebase Auth-Status der Flutter App.
export const smartAssistantFunction = onCallGenkit({
  authPolicy: (auth) => {
    // Demo-Policy: Nur eingeloggte Nutzer dürfen die KI nutzen
    if (!auth) {
      throw new Error('Nicht autorisiert! Bitte logge dich in der App ein.');
    }
  },
}, smartAssistantFlow);
