import { genkit, z } from 'genkit';
import { googleAI, gemini15Flash } from '@genkit-ai/googleai';
import axios from 'axios';

// 1. Initialisiere Genkit mit Google AI
const ai = genkit({
  plugins: [googleAI()],
  model: gemini15Flash,
});

// 2. Definiere das Tool für die DB Timetable API (Simuliert als MCP-Logik)
// In einer echten MCP-Implementierung würde dies über createMcpClient laufen.
export const getTrainTimetable = ai.defineTool(
  {
    name: 'getTrainTimetable',
    description: 'Ruft aktuelle Abfahrtsdaten und Verspätungen der Deutschen Bahn ab.',
    inputSchema: z.object({
      stationId: z.string().describe('Die EVA_ID des Bahnhofs (z.B. 8000105 für Frankfurt Hbf)'),
      date: z.string().describe('Datum im Format YYMMDD'),
      hour: z.string().describe('Stunde im Format HH'),
    }),
    outputSchema: z.any(),
  },
  async (input) => {
    // Hier würde der echte API Call zur DB Timetable API stehen.
    // Für die Demo nutzen wir Beispieldaten, um die Logik zu zeigen.
    console.log(`Abfrage für Station ${input.stationId} am ${input.date} um ${input.hour} Uhr.`);
    
    // Beispielhafte Antwortstruktur der DB API
    return {
      trains: [
        {
          id: 'ICE 74',
          destination: 'Berlin Hbf',
          scheduledTime: '10:48',
          actualTime: '11:03',
          delay: 15,
          platform: '4',
          newPlatform: '6',
          status: 'delayed',
        }
      ]
    };
  }
);

// 3. Definiere den Output-Schema für Flutter AiRichDataCard
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

// 4. Der Haupt-Flow für die Flutter App
export const trainStatusFlow = ai.defineFlow(
  {
    name: 'trainStatusFlow',
    inputSchema: z.string(), // User Nachricht: "Ist der ICE 74 pünktlich?"
    outputSchema: AiRichDataCardSchema,
  },
  async (userInput) => {
    const response = await ai.generate({
      prompt: userInput,
      tools: [getTrainTimetable],
      system: `Du bist ein DB Reiseassistent. Nutze das Tool 'getTrainTimetable' um Informationen zu finden.
      Wenn ein Zug verspätet ist oder sich das Gleis ändert, antworte IMMER mit strukturierten Daten für die 'richCard'.
      Deine Antwort sollte freundlich sein.`,
    });

    const data = response.output();
    // Hier erfolgt das Mapping auf das Flutter Schema
    // (Vereinfacht für die Demo-Logik)
    return {
      text: response.text,
      richCard: {
        trainId: 'ICE 74',
        route: 'Zürich HB → Berlin Hbf',
        delayMinutes: 15,
        status: 'DELAYED',
        scheduledTime: '10:48',
        expectedTime: '11:03',
        platformInfo: 'Pl. 4 -> Pl. 6',
        showCard: true,
      }
    };
  }
);
