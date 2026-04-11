import { type TelemetryIntegration } from 'ai';

/**
 * Console-based telemetry integration.
 * Logs every tool call, step, and final usage to the server console.
 * Swap this out for Braintrust/Langfuse by replacing with their SDK integration.
 */
export const consoleTelemetry: TelemetryIntegration = {
  onToolCallStart({ functionId, toolCall, metadata }) {
    console.log(
      `[telemetry:${functionId}] tool start | ${toolCall.toolName}`,
      metadata ? `| ${JSON.stringify(metadata)}` : '',
      '\n  input:', JSON.stringify(toolCall.input).slice(0, 200),
    );
  },

  onToolCallFinish({ functionId, toolCall, durationMs, ...event }) {
    if (event.success) {
      console.log(
        `[telemetry:${functionId}] tool ok | ${toolCall.toolName} | ${durationMs}ms`,
        '\n  output:', JSON.stringify(event.output).slice(0, 300),
      );
    } else {
      console.error(
        `[telemetry:${functionId}] tool error | ${toolCall.toolName} | ${durationMs}ms`,
        '\n  error:', String(event.error),
      );
    }
  },

  onStepFinish({ stepNumber, usage, toolCalls }) {
    const tools = (toolCalls ?? []).map(c => c.toolName).join(', ');
    console.log(
      `[telemetry] step ${stepNumber} done | tokens in:${usage?.inputTokens ?? '?'} out:${usage?.outputTokens ?? '?'}`,
      tools ? `| tools: ${tools}` : '',
    );
  },

  onFinish({ functionId, totalUsage, steps, metadata }) {
    console.log(
      `[telemetry:${functionId}] finished | steps:${steps.length}`,
      `| total tokens in:${totalUsage.inputTokens} out:${totalUsage.outputTokens}`,
      metadata ? `| ${JSON.stringify(metadata)}` : '',
    );
  },
};
