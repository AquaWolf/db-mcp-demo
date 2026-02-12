import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import * as dotenv from "dotenv";
dotenv.config();
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
});
const DB_BASE_URL = "https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1";
const DB_HEADERS = {
    "DB-Client-Id": process.env.DB_CLIENT_ID || "",
    "DB-Api-Key": process.env.DB_API_KEY || "",
    "Accept": "application/xml",
};
const server = new McpServer({
    name: "db-timetable-provider",
    version: "1.2.0"
});
server.tool("search_station", { name: z.string().describe("Name des Bahnhofs, z.B. 'Berlin Hbf'") }, async ({ name }) => {
    try {
        const response = await axios.get(`${DB_BASE_URL}/station/${encodeURIComponent(name)}`, { headers: DB_HEADERS });
        const jsonObj = parser.parse(response.data);
        const stations = jsonObj.stations?.station;
        if (!stations)
            return { content: [{ type: "text", text: "Keine Bahnhöfe gefunden." }] };
        const stationList = Array.isArray(stations) ? stations : [stations];
        const resultText = stationList.map((s) => `${s.name} (EVA_ID: ${s.eva})`).join("\n");
        return { content: [{ type: "text", text: `Gefundene Bahnhöfe:\n${resultText}` }] };
    }
    catch (error) {
        return { content: [{ type: "text", text: `Fehler: ${error.message}` }] };
    }
});
server.tool("get_timetable", {
    evaId: z.string(),
    date: z.string(),
    hour: z.string()
}, async ({ evaId, date, hour }) => {
    try {
        const planRes = await axios.get(`${DB_BASE_URL}/plan/${evaId}/${date}/${hour}`, { headers: DB_HEADERS });
        const planObj = parser.parse(planRes.data);
        const fchgRes = await axios.get(`${DB_BASE_URL}/fchg/${evaId}`, { headers: DB_HEADERS });
        const fchgObj = parser.parse(fchgRes.data);
        const planItems = planObj.timetable?.s ? (Array.isArray(planObj.timetable.s) ? planObj.timetable.s : [planObj.timetable.s]) : [];
        const changeItems = fchgObj.timetable?.s ? (Array.isArray(fchgObj.timetable.s) ? fchgObj.timetable.s : [fchgObj.timetable.s]) : [];
        const results = planItems.map((s) => {
            const change = changeItems.find((c) => c.id === s.id);
            const trainId = `${s.tl?.c || ""} ${s.tl?.n || ""}`.trim();
            const scheduledTime = s.ar?.pt || s.dp?.pt || "";
            const actualTime = change?.ar?.ct || change?.dp?.ct || scheduledTime;
            const scheduledPlatform = s.ar?.pp || s.dp?.pp || "";
            const actualPlatform = change?.ar?.cp || change?.dp?.cp || scheduledPlatform;
            return {
                id: s.id,
                train: trainId,
                destination: s.dp?.l || "N/A",
                scheduled: scheduledTime.slice(-4),
                actual: actualTime.slice(-4),
                delay: actualTime !== scheduledTime,
                platform: scheduledPlatform,
                newPlatform: actualPlatform !== scheduledPlatform ? actualPlatform : undefined
            };
        });
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
    catch (error) {
        return { content: [{ type: "text", text: `Fehler: ${error.message}` }] };
    }
});
// NEUES TOOL: Alternative Verbindungen suchen
server.tool("find_alternatives", {
    originEvaId: z.string(),
    destinationEvaId: z.string(),
    time: z.string().describe("Format HH:mm")
}, async ({ originEvaId, destinationEvaId, time }) => {
    // In der Demo simulieren wir die Suche nach Alternativen, 
    // da die DB Trip Search API einen separaten Key benötigt.
    return {
        content: [{
                type: "text",
                text: JSON.stringify([
                    { train: "RE 2", departure: "11:15", platform: "2", status: "ON TIME" },
                    { train: "ICE 542", departure: "11:45", platform: "9", status: "ON TIME" }
                ])
            }]
    };
});
// Alte SSEServerTransport Implementierung ist veraltet.
// Wir nutzen nun StreamableHTTPServerTransport für bessere Stabilität und Standardkonformität.
const transport = new StreamableHTTPServerTransport();
// Express App erstellen
const app = express();
async function startServer() {
    await server.connect(transport);
    // Unterstützt sowohl SSE (GET) als auch Nachrichten (POST) über denselben Endpunkt
    app.all("/sse", async (req, res) => {
        await transport.handleRequest(req, res);
    });
    //  Optional: Separater Endpunkt für Nachrichten, falls Clients dies erwarten
    app.post("/messages", async (req, res) => {
        await transport.handleRequest(req, res);
    });
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
        console.log(`DB MCP Server läuft auf http://localhost:${PORT}/sse`);
    });
}
startServer().catch((err) => {
    console.error("Fehler beim Starten des Servers:", err);
});
