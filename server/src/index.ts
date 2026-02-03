import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import * as dotenv from "dotenv";

dotenv.config();

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
});

// DB API Config
const DB_BASE_URL = "https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1";
const DB_HEADERS = {
  "DB-Client-Id": process.env.DB_CLIENT_ID || "",
  "DB-Api-Key": process.env.DB_API_KEY || "",
  "Accept": "application/xml",
};

// 1. MCP Server initialisieren
const server = new McpServer({
  name: "db-timetable-provider",
  version: "1.1.0"
});

// 2. Tool: Bahnhofssuche (EVA_ID finden)
server.tool(
  "search_station",
  { name: z.string().describe("Name des Bahnhofs, z.B. 'Berlin Hbf'") },
  async ({ name }) => {
    try {
      const response = await axios.get(`${DB_BASE_URL}/station/${encodeURIComponent(name)}`, { headers: DB_HEADERS });
      const jsonObj = parser.parse(response.data);
      const stations = jsonObj.stations?.station;
      
      if (!stations) return { content: [{ type: "text", text: "Keine Bahnhöfe gefunden." }] };
      
      const stationList = Array.isArray(stations) ? stations : [stations];
      const resultText = stationList.map((s: any) => `${s.name} (EVA_ID: ${s.eva})`).join("\n");
      
      return {
        content: [{ type: "text", text: `Gefundene Bahnhöfe:\n${resultText}` }]
      };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Fehler bei der Bahnhofssuche: ${error.message}` }] };
    }
  }
);

// 3. Tool: Fahrplan abrufen (Kombiniert Plan & Changes)
server.tool(
  "get_timetable",
  { 
    evaId: z.string().describe("Die EVA_ID des Bahnhofs"),
    date: z.string().describe("Datum im Format YYMMDD"),
    hour: z.string().describe("Stunde im Format HH")
  },
  async ({ evaId, date, hour }) => {
    try {
      // 1. Geplante Daten laden
      const planRes = await axios.get(`${DB_BASE_URL}/plan/${evaId}/${date}/${hour}`, { headers: DB_HEADERS });
      const planObj = parser.parse(planRes.data);
      
      // 2. Aktuelle Änderungen (Verspätungen) laden
      const fchgRes = await axios.get(`${DB_BASE_URL}/fchg/${evaId}`, { headers: DB_HEADERS });
      const fchgObj = parser.parse(fchgRes.data);

      const planItems = planObj.timetable?.s ? (Array.isArray(planObj.timetable.s) ? planObj.timetable.s : [planObj.timetable.s]) : [];
      const changeItems = fchgObj.timetable?.s ? (Array.isArray(fchgObj.timetable.s) ? fchgObj.timetable.s : [fchgObj.timetable.s]) : [];

      // Mapping & Merging
      const results = planItems.map((s: any) => {
        const change = changeItems.find((c: any) => c.id === s.id);
        const trainId = `${s.tl?.c || ""} ${s.tl?.n || ""}`.trim();
        
        // Geplante vs. Aktuelle Ankunft/Abfahrt
        const scheduledTime = s.ar?.pt || s.dp?.pt || "";
        const actualTime = change?.ar?.ct || change?.dp?.ct || scheduledTime;
        
        // Plattform Info
        const scheduledPlatform = s.ar?.pp || s.dp?.pp || "";
        const actualPlatform = change?.ar?.cp || change?.dp?.cp || scheduledPlatform;

        return {
          id: s.id,
          train: trainId,
          destination: s.dp?.l || "N/A",
          scheduled: scheduledTime.slice(-4), // HHmm
          actual: actualTime.slice(-4),
          delay: actualTime !== scheduledTime,
          platform: scheduledPlatform,
          newPlatform: actualPlatform !== scheduledPlatform ? actualPlatform : undefined
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Fehler beim Abrufen des Fahrplans: ${error.message}` }] };
    }
  }
);

// 4. Express Server mit SSE aufsetzen
const app = express();
let transport: SSEServerTransport | undefined;

app.get("/sse", async (req, res) => {
  console.log("Neuer SSE-Client verbunden");
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Echter DB MCP Server läuft auf http://localhost:${PORT}/sse`);
});
