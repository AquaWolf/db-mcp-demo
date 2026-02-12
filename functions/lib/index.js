"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.smartAssistantFunction = exports.smartAssistantFlow = exports.ai = void 0;
const genkit_1 = require("genkit");
const google_genai_1 = require("@genkit-ai/google-genai");
const mcp_1 = require("@genkit-ai/mcp");
const https_1 = require("firebase-functions/v2/https");
console.log("Starting Genkit initialization...");
// 1. Initialisiere Genkit
exports.ai = (0, genkit_1.genkit)({
    plugins: [(0, google_genai_1.googleAI)()],
});
// 2. Configure the MCP Host (Management Object)
const dbHost = (0, mcp_1.createMcpHost)({
    name: 'db-timetable-host',
    mcpServers: {
        // 'db' becomes the namespace (e.g. db/search_station)
        db: { url: 'http://127.0.0.1:3001/sse' }
    }
});
console.log("Starting Genkit Message Schema Definition...");
// 3. Schema Definitionen
const MessageSchema = genkit_1.z.object({
    role: genkit_1.z.enum(['user', 'model', 'system']),
    content: genkit_1.z.array(genkit_1.z.object({ text: genkit_1.z.string() })),
});
const UniversalResponseSchema = genkit_1.z.object({
    text: genkit_1.z.string(),
    responseType: genkit_1.z.enum(["GENERAL", "TRAIN_STATUS"]),
    richCard: genkit_1.z.object({
        trainId: genkit_1.z.string(),
        route: genkit_1.z.string(),
        delayMinutes: genkit_1.z.number(),
        status: genkit_1.z.string(),
        scheduledTime: genkit_1.z.string(),
        expectedTime: genkit_1.z.string(),
        platformInfo: genkit_1.z.string(),
        showCard: genkit_1.z.boolean(),
    }).optional(),
});
console.log("Starting Genkit Flow Definition...");
// 4. Define the flow separately
exports.smartAssistantFlow = exports.ai.defineFlow({
    name: 'smartAssistantFlow',
    inputSchema: genkit_1.z.object({
        prompt: genkit_1.z.string(),
        history: genkit_1.z.array(MessageSchema).optional(),
    }),
    outputSchema: UniversalResponseSchema,
}, async (input) => {
    const mcpTools = await dbHost.getActiveTools(exports.ai);
    console.log(`Available tools: ${mcpTools.map(t => t.name).join(', ')}`); // Check your terminal!
    if (mcpTools.length === 0) {
        throw new Error("No tools found! Is the MCP server running on 3001?");
    }
    const messages = [...(input.history || [])];
    messages.push({ role: 'user', content: [{ text: input.prompt }] });
    const response = await exports.ai.generate({
        messages: messages,
        tools: mcpTools,
        model: google_genai_1.googleAI.model('gemini-2.5-flash'),
        system: `Du bist ein DB Reiseassistent. Die aktuelle Zeit ist ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}. Nutze den MCP Server um Informationen zu finden. Wenn du dem Benutzer final antwortest, nutze das vorgegebene JSON-Format. Wenn ein Fehler auftritt oder keine Daten gefunden werden, setze responseType auf 'GENERAL' und erkläre das Problem im 'text' Feld.`,
        output: { schema: UniversalResponseSchema },
        config: {
            temperature: 0.8,
        },
    });
    const result = response.output;
    if (!result)
        throw new Error("No output generated");
    return result;
});
console.log("Starting Genkit Expose as Cloud Function using onCall...");
// 5. Expose as Cloud Function using onCall
exports.smartAssistantFunction = (0, https_1.onCall)(async (request) => {
    // Auth Policy Check
    if (!request.auth) {
        throw new Error('Nicht autorisiert! Bitte logge dich in der App ein.');
    }
    // Run the flow with auth context
    const result = await exports.smartAssistantFlow.run(request.data, {
        context: {
            auth: request.auth
        }
    });
    return result;
});
//# sourceMappingURL=index.js.map