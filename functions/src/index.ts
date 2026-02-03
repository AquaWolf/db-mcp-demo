import { genkit, z } from 'genkit';
import { googleAI, gemini15Flash } from '@genkit-ai/googleai';
import { firebase } from '@genkit-ai/firebase';

// 1. Initialisiere Genkit
const ai = genkit({
  plugins: [googleAI(), firebase()],
  model: gemini15Flash,
});

// Hinweis: In der Cloud-Variante würden wir hier createMcpClient nutzen,
// um den MCP-Server (Cloud Run) anzubinden. Für die Demo-Integration
// definieren wir die Tool-Schnittstellen hier, die auf den MCP Server mappen.

const searchStationTool = ai.defineTool(
  {
    name: 'search_station',
    description: 'Sucht einen Bahnhof und liefert die EVA_ID.',
    inputSchema: z.object({ name: z.string() }),
    outputSchema: z.string(),
  },
  async (input) => {
    // Hier Aufruf an MCP Server / API
    return "Berlin Hbf (EVA_ID: 8011160)";
  }
);

const getTimetableTool = ai.defineTool(
  {
    name: 'get_timetable',
    description: 'Ruft den Fahrplan für eine EVA_ID ab.',
    inputSchema: z.object({
      evaId: z.string(),
      date: z.string(), // YYMMDD
      hour: z.string(), // HH
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    // Hier Aufruf an MCP Server / API
    return JSON.stringify([{
      train: "ICE 74",
      destination: "Berlin Hbf",
      scheduled: "1048",
      actual: "1103",
      delay: true,
      platform: "4",
      newPlatform: "6"
    }]);
  }
);

// 3. Output Schema für Flutter
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
    const response = await ai.generate({
      prompt: userInput,
      tools: [searchStationTool, getTimetableTool],
      system: `Du bist ein DB Reiseassistent.
      Schritt 1: Finde die EVA_ID des Bahnhofs mit 'search_station'.
      Schritt 2: Nutze das aktuelle Datum (YYMMDD) und die Stunde (HH) für 'get_timetable'.
      Schritt 3: Analysiere die Daten. Wenn ein Zug (z.B. ICE 74) verspätet ist, erstelle die 'richCard'.
      Formatiere Zeitangaben von HHmm zu HH:mm.`,
    });

    const output = response.output();
    
    // In einer echten Implementierung extrahiert Gemini hier die Daten.
    // Wir simulieren das Mapping für die Demo-Stabilität:
    return {
      text: response.text,
      richCard: {
        trainId: 'ICE 74',
        route: 'Zürich HB → Berlin Hbf',
        delayMinutes: 15,
        status: 'DELAYED',
        scheduledTime: '10:48',
        expectedTime: '11:03',
        platformInfo: 'Gleis 4 -> 6',
        showCard: true,
      }
    };
  }
);
