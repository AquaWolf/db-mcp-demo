import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { createMcpHost } from '@genkit-ai/mcp';
import { onCall } from 'firebase-functions/v2/https';

console.log("Starting Genkit initialization...");
// 1. Initialisiere Genkit
export const ai = genkit({
  plugins: [googleAI()],
});

// 2. Configure the MCP Host (Management Object)
const dbHost = createMcpHost({
  name: 'db-timetable-host',
  mcpServers: {
    // 'db' becomes the namespace (e.g. db/search_station)
    db: { url: 'http://127.0.0.1:3001/sse' }
  }
});

console.log("Starting Genkit Message Schema Definition...");
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

console.log("Starting Genkit Flow Definition...");
// 4. Define the flow separately
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
    const mcpTools = await dbHost.getActiveTools(ai);
    console.log(`Available tools: ${mcpTools.map(t => t.name).join(', ')}`); // Check your terminal!

    if (mcpTools.length === 0) {
      throw new Error("No tools found! Is the MCP server running on 3001?");
    }

    const messages = [...(input.history || [])];
    messages.push({ role: 'user', content: [{ text: input.prompt }] });

    const response = await ai.generate({
      messages: messages,
      tools: mcpTools,
      model: googleAI.model('gemini-2.5-flash'),
      system: `Du bist ein DB Reiseassistent. Die aktuelle Zeit ist ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}. Nutze den MCP Server um Informationen zu finden. Wenn du dem Benutzer final antwortest, nutze das vorgegebene JSON-Format. Wenn ein Fehler auftritt oder keine Daten gefunden werden, setze responseType auf 'GENERAL' und erkläre das Problem im 'text' Feld.`,
      output: { schema: UniversalResponseSchema },
      config: {
        temperature: 0.8,
      },
    });

    const result = response.output;
    if (!result) throw new Error("No output generated");
    return result;
  }
);
console.log("Starting Genkit Expose as Cloud Function using onCall...");
// 5. Expose as Cloud Function using onCall
export const smartAssistantFunction = onCall(
  async (request) => {
    // Auth Policy Check
    if (!request.auth) {
      throw new Error('Nicht autorisiert! Bitte logge dich in der App ein.');
    }

    // Run the flow with auth context
    const result = await smartAssistantFlow.run(
      request.data,
      {
        context: {
          auth: request.auth
        }
      }
    );
    return result;
  }
);
