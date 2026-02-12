import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import cors from "cors";
import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import * as dotenv from "dotenv";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import { randomUUID } from "node:crypto";

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

const createMcpServer = () => {
  const server = new McpServer({
    name: "db-timetable-provider",
    version: "1.2.0"
  });

  server.registerTool(
    "search_station",
    {
      description: "Suche nach einem Bahnhof nach Namen",
      inputSchema: { name: z.string().describe("Name des Bahnhofs, z.B. 'Berlin Hbf'") }
    },
    async ({ name }) => {
      try {
        const response = await axios.get(`${DB_BASE_URL}/station/${encodeURIComponent(name)}`, { headers: DB_HEADERS });
        const jsonObj = parser.parse(response.data);
        const stations = jsonObj.stations?.station;
        if (!stations) return { content: [{ type: "text", text: "Keine Bahnhöfe gefunden." }] };
        const stationList = Array.isArray(stations) ? stations : [stations];
        const resultText = stationList.map((s: any) => `${s.name} (EVA_ID: ${s.eva})`).join("\n");
        return { content: [{ type: "text", text: `Gefundene Bahnhöfe:\n${resultText}` }] };
      } catch (error: any) {
        if (axios.isAxiosError(error)) {
          console.error("DB API Error in search_station:", error.response?.status, error.response?.data);
        } else {
          console.error("Error in search_station:", error);
        }
        return { content: [{ type: "text", text: `Fehler: ${error.message}` }] };
      }
    }
  );

  server.registerTool(
    "get_timetable",
    {
      description: "Fahrplan für einen Bahnhof abrufen",
      inputSchema: {
        evaId: z.string(),
        date: z.string().describe("Datum im Format YYMMDD (z.B. 240520) oder YYYY-MM-DD"),
        hour: z.string().describe("Stunde im Format HH (z.B. 10)")
      }
    },
    async ({ evaId, date, hour }) => {
      try {
        // Format date to YYMMDD
        let formattedDate = date;
        if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          // YYYY-MM-DD -> YYMMDD
          formattedDate = date.slice(2).replace(/-/g, "");
        }

        // Format hour to HH
        let formattedHour = hour;
        if (hour.includes(":")) {
          formattedHour = hour.split(":")[0];
        }
        if (formattedHour.length === 1) {
          formattedHour = `0${formattedHour}`;
        }

        const planUrl = `${DB_BASE_URL}/plan/${evaId}/${formattedDate}/${formattedHour}`;
        console.log(`Fetching Plan from: ${planUrl}`);

        const planRes = await axios.get(planUrl, { headers: DB_HEADERS });
        const planObj = parser.parse(planRes.data);
        const fchgRes = await axios.get(`${DB_BASE_URL}/fchg/${evaId}`, { headers: DB_HEADERS });
        const fchgObj = parser.parse(fchgRes.data);

        const planItems = planObj.timetable?.s ? (Array.isArray(planObj.timetable.s) ? planObj.timetable.s : [planObj.timetable.s]) : [];
        const changeItems = fchgObj.timetable?.s ? (Array.isArray(fchgObj.timetable.s) ? fchgObj.timetable.s : [fchgObj.timetable.s]) : [];

        const results = planItems.map((s: any) => {
          const change = changeItems.find((c: any) => c.id === s.id);
          const trainId = `${s.tl?.c || ""} ${s.tl?.n || ""}`.trim();
          const scheduledTime = s.ar?.pt || s.dp?.pt || "";
          const actualTime = change?.ar?.ct || change?.dp?.ct || scheduledTime;
          const scheduledPlatform = s.ar?.pp || s.dp?.pp || "";
          const actualPlatform = change?.ar?.cp || change?.dp?.cp || scheduledPlatform;

          return {
            train: trainId,
            destination: s.dp?.l || "N/A",
            scheduled: scheduledTime.slice(-4),
            actual: actualTime.slice(-4),
            delay: actualTime !== scheduledTime ? "YES" : "NO",
            platform: actualPlatform !== scheduledPlatform ? `${actualPlatform} (Soll: ${scheduledPlatform})` : scheduledPlatform
          };
        }).slice(0, 5); // Limit to 5 entries to save context

        return { content: [{ type: "text", text: `Hier sind die nächsten 5 Verbindungen:\n${JSON.stringify(results, null, 2)}` }] };
      } catch (error: any) {
        if (axios.isAxiosError(error)) {
          console.error("DB API Error in get_timetable:", error.response?.status, error.response?.data);
          // Log URL specifically for 404
          if (error.response?.status === 404) {
            console.error(`Requested URL was: ${error.config?.url}`);
          }
        } else {
          console.error("Error in get_timetable:", error);
        }
        return { content: [{ type: "text", text: `Fehler: ${error.message}` }] };
      }
    }
  );

  server.registerTool(
    "find_alternatives",
    {
      description: "Finde alternative Verbindungen",
      inputSchema: { originEvaId: z.string(), destinationEvaId: z.string(), time: z.string().describe("Format HH:mm") }
    },
    async ({ originEvaId, destinationEvaId, time }) => {
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
    }
  );

  server.registerTool(
    "get_time",
    {
      description: "Gibt die aktuelle Uhrzeit in Deutschland zurück.",
      inputSchema: z.object({})
    },
    async () => {
      const now = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
      return {
        content: [{ type: "text", text: `Aktuelle Zeit in Deutschland: ${now}` }]
      };
    }
  );

  return server;
};

// Maps to store transports and servers by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};
const servers: { [sessionId: string]: McpServer } = {};

const app = express();
app.use(express.json());
app.use(cors());

app.get("/sse", async (req: any, res: any) => {
  console.log(`GET Request received: ${req.method} ${req.url}`);
  console.log("Query params:", JSON.stringify(req.query));
  console.log("Headers:", JSON.stringify(req.headers));

  try {
    const sessionId = (req.headers["mcp-session-id"] as string) || (req.query.sessionId as string);

    if (!sessionId || !transports[sessionId]) {
      console.log(`No valid session ID in GET request. Creating new session implicitly...`);

      const eventStore = new InMemoryEventStore();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        eventStore,
        onsessioninitialized: (id) => {
          transports[id] = transport;
          res.setHeader("X-Mcp-Session-Id", id);
        },
      });

      const newServer = createMcpServer();

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(`Transport closed for session ${sid}`);
          delete transports[sid];
          delete servers[sid];
        }
      };

      console.log(`Connecting implicit transport to MCP server...`);
      await newServer.connect(transport);

      console.log(`Starting SSE transport.handleRequest for new implicit session...`);

      // Inject the generated Session ID into request headers so SDK validation passes
      // We need to pre-generate it or just generate one and pass it to transport options?
      // StreamableHTTPServerTransport uses the generator we passed.
      // But we can ALSO manually set the ID on the transport if we want? 
      // Actually, we can just spoof the header.

      // We used randomUUID() in the generator. Let's generic one for the header.
      const implicitSessionId = randomUUID();
      req.headers["mcp-session-id"] = implicitSessionId;

      // We must also ensure the transport uses THIS id.
      // The transport calls sessionIdGenerator() on initialization if it's a POST 'initialize'.
      // But for GET, it validates against existing sessionId.

      // Wait, if we are doing GET, the SDK assumes the session is ALREADY initialized?
      // validateSession: if (!this._initialized) return 400 server not initialized.

      // THIS IS THE BLOCKER.
      // The SDK's WebStandardStreamableHTTPServerTransport enforces that `initialize` (POST) 
      // must happen BEFORE any GET request (if stateful).

      // We CANNOT use a standard StreamableHTTPServerTransport to handle a GET-first connection 
      // if we want to be "stateful".

      // Exception: Stateless mode (sessionIdGenerator = undefined).
      // But we need state for tools?

      // WORKAROUND:
      // We can manually bypass the `handleRequest` for the GET and set up the stream ourselves,
      // creating a standard SSE stream that is backed by the transport's internals?
      // Too complex.

      // Alternative: Initialize the transport MANUALLY.
      // transport._webStandardTransport._initialized = true? (Private)

      // Let's use the workaround: Stateless mode for THIS SPECIFIC implicit session?
      // If we pass `sessionIdGenerator: undefined` to the transport, it acts stateless.
      // But Genkit might expect a session ID back?

      // Let's try sending a proper SSE stream but managing it manually for the handshake.

      // Actually, let's keep it simple.
      // If Genkit is crashing on 400 for the ID-less GET, but successfully connects later...
      // Maybe we just need to return 200 OK and hang up?
      // "Non-200 status code (400)" implies it wants 200.

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Mcp-Session-Id": implicitSessionId
      });
      // Send a comment to keep it alive briefly
      res.write(": ok\n\n");

      // We don't actually hook it up to the transport because the transport refuses it.
      // We just satisfy the client's "check" so it proceeds to the REAL connection (which we saw it does).

      console.log(`Sent 200 OK (fake SSE) for implicit GET. SessionHint: ${implicitSessionId}`);
      return;
    }

    const transport = transports[sessionId];
    console.log(`Starting SSE transport.handleRequest for session ${sessionId}...`);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("Error handling GET request:", error);
    if (!res.headersSent) {
      res.status(500).send("Internal server error");
    }
  }
});

app.post("/sse", async (req: any, res: any) => {
  console.log(`POST Request received: ${req.method} ${req.url}`);
  console.log(`Headers:`, JSON.stringify(req.headers));

  try {
    const sessionId = (req.headers["mcp-session-id"] as string) || (req.query.sessionId as string);
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      console.log("New session request");
      const eventStore = new InMemoryEventStore();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        eventStore,
        onsessioninitialized: (id) => {
          transports[id] = transport;
          res.setHeader("X-Mcp-Session-Id", id);
        },
      });

      // Create a fresh server instance for this session
      const newServer = createMcpServer();

      // Clean up transport and server when closed
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(`Transport closed for session ${sid}`);
          delete transports[sid];
          delete servers[sid]; // Cleanup server instance
        }
      };

      console.log(`Connecting transport to MCP server...`);
      await newServer.connect(transport);

      // Store the server instance (optional, mainly for debugging or advanced cleanup)
      // Note: We can't key by sessionId yet because it might not be generated until handleRequest starts?
      // Actually, StreamableHTTPServerTransport generates it internally on init.
      // But we can just rely on the transport closure to clean up.

      // We need to wait for the session ID to be available to store it in `servers` map if we want to tracking.
      // But the transport.sessionId isn't set until AFTER handleRequest processes the init message.
      // So we can do it in onsessioninitialized if needed, but for now we just let it be.

      console.log(`Transport connected to MCP server successfully`);

      console.log(`Handling initialization request...`);
      await transport.handleRequest(req, res, req.body);

      // Now sessionId should be available if initialized
      if (transport.sessionId) {
        servers[transport.sessionId] = newServer;
      }

      console.log(`Initialization request handled`);
      return;
    } else {
      console.error("Invalid request: No valid session ID or initialization request");
      res.status(400).send("Invalid request");
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling POST request:", error);
    if (!res.headersSent) {
      res.status(500).send("Internal server error");
    }
  }
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, "0.0.0.0", () => {

  console.log(`DB MCP Server läuft auf http://localhost:${PORT}/sse`);
});
