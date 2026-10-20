import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function run() {
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=9228',
    '--disable-gpu-sandbox',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--window-size=1280,720',
    '--user-data-dir=C:\\Users\\Mechrevo\\AppData\\Local\\Temp\\edge_debug_paint_profile',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 1500));

  const req = http.request('http://127.0.0.1:9228/json/new?http://localhost:5273', { method: 'PUT' }, (res) => {
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

        // Wait 3.5s for game
        await new Promise(r => setTimeout(r, 3500));

        // Inject ink painting directly in front of the local player
        const res = await send('Runtime.evaluate', {
          expression: `
            (() => {
              const g = window.game;
              if (g && g.paintEngine && g.localPlayer) {
                const pPos = g.localPlayer.position;
                const size = g.activeMapDef.size;
                const half = size / 2;
                // Look direction is towards center
                const targetX = pPos.x > 0 ? pPos.x - 7 : pPos.x + 7;
                const targetZ = pPos.z;
                const u = (targetX + half) / size;
                const v = (targetZ + half) / size;
                g.paintEngine.applyPaintBatch([
                  {
                    id: 9999,
                    team: 1, // Cyan
                    u: u,
                    v: v,
                    radius: 7.0 / size,
                    seed: 1234
                  },
                  {
                    id: 9998,
                    team: 2, // Pink
                    u: (targetX + (pPos.x > 0 ? -4 : 4) + half) / size,
                    v: (targetZ + 2.5 + half) / size,
                    radius: 5.5 / size,
                    seed: 5678
                  }
                ]);
                return 'painted at ' + targetX + ',' + targetZ;
              }
              return 'failed: ' + (g ? 'has game' : 'no game');
            })()
          `,
          returnByValue: true
        });
        console.log('Direct paint result:', res);

        await new Promise(r => setTimeout(r, 1000));

        const screenshot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync('c:\\Users\\Mechrevo\\Downloads\\splatoon\\screenshot_direct_paint.png', Buffer.from(screenshot.data, 'base64'));
        console.log('Saved screenshot_direct_paint.png');

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
