import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3003/ws');
const msgs = [];
let done = false;

ws.on('open', () => {
  console.log('--- Connected ---');
  ws.send(JSON.stringify({ type: 'chat', content: 'Create a Diwali sale ad for my jewelry shop in Telugu' }));
  console.log('--- Message sent ---');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  msgs.push(msg);

  switch (msg.type) {
    case 'connected':
    case 'subscribed':
      console.log(`[${msg.type}]`);
      break;

    case 'session_init':
      console.log('[session_init] id:', msg.sessionId);
      break;

    case 'system':
      console.log('[system]', msg.subtype || '');
      break;

    case 'message_start':
      console.log('\n--- assistant turn ---');
      break;

    case 'block_start':
      if (msg.blockType === 'tool_use') {
        console.log(`\n[tool_use] ${msg.toolName} (id: ${msg.toolId})`);
      }
      break;

    case 'block_delta':
      if (msg.text) {
        process.stdout.write(msg.text);
      }
      if (msg.inputJsonDelta) {
        process.stdout.write(msg.inputJsonDelta);
      }
      break;

    case 'block_end':
      break;

    case 'message_type_hint':
      break;

    case 'message_stop':
      console.log(`\n[message_stop] reason: ${msg.stopReason}`);
      break;

    case 'tool_complete':
      console.log(`[tool_complete] ${msg.toolName}`);
      break;

    case 'notification':
      console.log(`[notification] ${msg.title}: ${msg.message}`);
      break;

    case 'action_instance':
      console.log(`\n[action_instance] ${msg.templateId}: ${msg.label}`);
      break;

    case 'error':
      console.log('[error]', msg.error);
      break;

    case 'complete':
      console.log(`\n[complete] cost: $${msg.costUsd?.toFixed(4) || 'N/A'}`);
      if (msg.instrumentation) {
        console.log(`  turns: ${msg.instrumentation.summary?.totalTurns}`);
        console.log(`  tools: ${msg.instrumentation.summary?.totalTools}`);
      }
      done = true;
      ws.close();
      break;

    default:
      console.log(`[${msg.type}]`);
  }
});

ws.on('error', (err) => { console.error('WS Error:', err.message); });
ws.on('close', () => {
  console.log('--- Disconnected ---');
  console.log('Total messages received:', msgs.length);
  process.exit(0);
});

setTimeout(() => {
  if (!done) {
    console.log('\n--- Timeout (90s) ---');
    console.log('Total messages received:', msgs.length);
    if (msgs.length > 0) console.log('Last message type:', msgs[msgs.length - 1]?.type);
    ws.close();
    process.exit(0);
  }
}, 90000);
