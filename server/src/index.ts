import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import axios from "axios";

// 1. MCP Server initialisieren
const server = new McpServer({
  name: "db-timetable-provider",
  version: "1.0.0"
});

// 2. Tool: Bahnhofssuche (EVA_ID finden)
server.tool(
  "search_station",
  { name: z.string().describe("Name des Bahnhofs, z.B. 'Berlin Hbf'") },
  async ({ name }) => {
    // Hier würde der Call zur DB Station Data API erfolgen.
    // Für die Demo nutzen wir eine simulierte Antwort.
    return {
      content: [{ 
        type: "text", 
        text: `Suche nach "${name}" erfolgreich. EVA_ID: 8011160 (Berlin Hbf)` 
      }]
    };
  }
);

// 3. Tool: Fahrplan abrufen
server.tool(
  "get_timetable",
  { 
    evaId: z.string().describe("Die EVA_ID des Bahnhofs"),
    date: z.string().describe("Datum im Format YYMMDD"),
    hour: z.string().describe("Stunde im Format HH")
  },
  async ({ evaId, date, hour }) => {
    // Call zur DB Timetable API (simuliert)
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          station: "Berlin Hbf",
          trains: [
            { id: "ICE 74", time: "10:48", delay: "+15", platform: "4", newPlatform: "6" }
          ]
        })
      }]
    };
  }
);

// 4. Express Server mit SSE aufsetzen
const app = express();
let transport: SSEServerTransport | undefined;

app.get("/sse", async (req, res) => {
  console.log("Neuer SSE-Client (z.B. GenKit) verbunden");
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
  console.log(`MCP Server läuft auf http://localhost:${PORT}/sse`);
});
