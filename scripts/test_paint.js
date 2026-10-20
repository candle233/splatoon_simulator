import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function run() {
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu-sandbox',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--window-size=1280,720',
    '--user-data-dir=C:\\Users\\Mechrevo\\AppData\\Local\\Temp\\edge_debug_profile',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 1500));

  const req = http.request('http://127.0.0.1:9222/json/new?http://localhost:5273', { method: 'PUT' }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', async () => {
      try {
        const target = JSON.parse(data);
        const ws = new WebSocket(target.webSocketDebuggerUrl);

        let id = 1;
        const pendingCallbacks = new Map();
        const send = (method, params = {}) => {
          const reqId = id++;
          return new Promise((resolve, reject) => {
            pendingCallbacks.set(reqId, { resolve, reject });
            ws.send(JSON.stringify({ id: reqId, method, params }));
          });
        };

        ws.onopen = async () => {
          await send('Runtime.enable');
          await send('Log.enable');
          await send('Page.enable');
        };

        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id && pendingCallbacks.has(msg.id)) {
            const cb = pendingCallbacks.get(msg.id);
            pendingCallbacks.delete(msg.id);
            if (msg.error) cb.reject(msg.error);
            else cb.resolve(msg.result);
            return;
          }
          if (msg.method === 'Runtime.consoleAPICalled') {
            console.log(`[Console ${msg.params.type}]:`, ...msg.params.args.map(a => a.value ?? a.description ?? JSON.stringify(a)));
          }
        };

        await new Promise(r => setTimeout(r, 2000));
        await send('Runtime.evaluate', { expression: `document.querySelector('#btn-title-play')?.click()` });
        await new Promise(r => setTimeout(r, 1000));
        await send('Runtime.evaluate', { expression: `(document.querySelector('#btn-dock-solo') || document.querySelector('#btn-ready'))?.click()` });

        // Wait 3.5s for countdown to finish and game to start
        await new Promise(r => setTimeout(r, 3500));

        // Now fire paint at ground: call window.game.paintEngine directly or trigger shoot
        const paintResult = await send('Runtime.evaluate', {
          expression: `
            (() => {
              // Access game instance
              const canvas = document.querySelector('#webgl-canvas');
              // Let's check window object or dispatch mouse events to shoot
              const mousedown = new MouseEvent('mousedown', { button: 0, clientX: 640, clientY: 500 });
              window.dispatchEvent(mousedown);
              return 'fired mousedown';
            })()
          `,
          returnByValue: true
        });
        console.log('Paint action:', paintResult);

        // Wait 2 seconds for ink to be painted and snapshots to arrive
        await new Promise(r => setTimeout(r, 2000));

        const screenshot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync('c:\\Users\\Mechrevo\\Downloads\\splatoon\\screenshot_paint.png', Buffer.from(screenshot.data, 'base64'));
        console.log('Saved screenshot_paint.png');

        ws.close();
      } catch (err) {
        console.error('Error in test:', err);
      } finally {
        edge.kill();
        process.exit(0);
      }
    });
  });
  req.on('error', (e) => {
    console.error('Failed to connect to Edge:', e);
    edge.kill();
    process.exit(1);
  });
  req.end();
}

run();
