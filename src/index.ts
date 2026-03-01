#!/usr/bin/env node
if (process.argv[2] === 'setup') {
  const { runSetup } = await import('./setup.js')
  await runSetup()
  process.exit(0)
}
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import type { Request, Response } from 'express';
import { IncomingMessage, ServerResponse } from 'node:http';
import { createDb } from './db.js';
import { createServer } from './server.js';

const db = createDb();
const mcpServer = createServer(db);

const useHttp =
  process.env.MCP_TRANSPORT === 'http' ||
  process.argv.includes('--http');

if (useHttp) {
  const app = express();
  const port = parseInt(process.env.MCP_PORT ?? '3456');

  const transports: Record<string, SSEServerTransport> = {};

  // Note: SSEServerTransport is deprecated in SDK v1.27+. Future: migrate to StreamableHTTPServerTransport
  // for better reconnection and streaming support.
  app.get('/mcp', async (req: Request, res: Response) => {
    const transport = new SSEServerTransport(
      '/mcp/message',
      res as unknown as ServerResponse
    );
    transports[transport.sessionId] = transport;

    // Clean up on disconnect to prevent memory leak
    res.on('close', () => {
      delete transports[transport.sessionId];
    });

    await mcpServer.connect(transport);
  });

  app.post('/mcp/message', express.json(), async (req: Request, res: Response) => {
    const sessionId = req.query['sessionId'] as string;
    const transport = transports[sessionId];
    if (!transport) {
      res.status(404).send('Session not found');
      return;
    }
    await transport.handlePostMessage(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse
    );
  });

  app.listen(port, () => {
    process.stderr.write(`[mtmem] HTTP/SSE MCP server listening on http://localhost:${port}/mcp\n`);
  }).on('error', (err: Error) => {
    process.stderr.write(`[mtmem] Failed to start HTTP server: ${err.message}\n`);
    process.exit(1);
  });
} else {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}
