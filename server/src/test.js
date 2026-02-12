import axios from 'axios';

async function testMcp() {
    const baseUrl = 'http://127.0.0.1:3001/sse';
    let sessionId = null;

    console.log("1. Testing INITIALIZE (POST) to start session...");
    try {
        const response = await axios.post(baseUrl, {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "test-client", version: "1.0.0" }
            }
        }, {
            headers: { 'Accept': 'application/json, text/event-stream' }
        });
        console.log("✅ POST successful!");
        console.log("Server Response:", JSON.stringify(response.data, null, 2));

        // Try to find session ID in headers
        // Note: The example repo sets transport for stored sessions.
        // We will look for X-Mcp-Session-Id or similar.
        // If not found in headers, we can't do step 2 easily with this pattern unless we parse it from response?
        // Actually, StreamableHTTPServerTransport (Stateful) usually sends `X-Mcp-Session-Id`.
        const headers = response.headers;
        console.log("Headers:", headers);
        sessionId = headers['x-mcp-session-id'] || headers['mcp-session-id'];

        if (sessionId) {
            console.log(`\nCaptured Session ID: ${sessionId}`);
        } else {
            console.log("\n⚠️ No session ID found in headers. If using Stateless mode, this is expected.");
        }

    } catch (error) {
        console.error("❌ POST failed!");
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error(`Data:`, error.response.data);
        } else {
            console.error(`Error: ${error.message}`);
        }
        return;
    }

    if (sessionId) {
        console.log("\n2. Testing SSE (GET) with Session ID...");
        try {
            const response = await axios.get(baseUrl, {
                headers: {
                    'Accept': 'text/event-stream',
                    'mcp-session-id': sessionId
                },
                params: { sessionId }, // Try both
                timeout: 2000,
                responseType: 'stream'
            });

            response.data.on('data', (chunk) => {
                console.log("Received chunk:", chunk.toString());
            });

            console.log("✅ SSE Stream connected and listening...");

            // Keep it open for a bit
            await new Promise(resolve => setTimeout(resolve, 3000));

        } catch (error) {
            if (error.code === 'ECONNABORTED') {
                console.log("✅ SSE Endpoint is reachable and kept open.");
            } else {
                console.error("❌ SSE GET failed:", error.message);
                if (error.response) console.error("Response:", error.response.data);
            }
        }
    } else {
        console.log("\nSkipping SSE test as no Session ID was captured.");
    }
}

testMcp();