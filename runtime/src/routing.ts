import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RouteCalculator, RouteError, routeToolDefinition } from '../../src/routing.ts';

export function registerRoutingTool(server: McpServer) {
  const point = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict();
  const calculator = new RouteCalculator({ apiKey: () => process.env.ORS_API_KEY ?? '' });
  server.registerTool('calculate_route', {
    title: 'Calculate driving or walking route', description: routeToolDefinition.function.description,
    inputSchema: { origin: point, destination: point, mode: z.enum(['driving', 'walking']), via: z.array(point).max(8).optional() },
  }, async (input, extra) => {
    try {
      const result = await calculator.calculate(input, extra.signal);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: { ...result } };
    } catch (error) {
      const result = { error: error instanceof RouteError ? error.code : 'routing_unavailable', note: error instanceof RouteError ? error.message : 'Route calculation interrupted or unavailable.' };
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
    }
  });
}
