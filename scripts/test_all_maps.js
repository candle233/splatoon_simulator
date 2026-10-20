import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const MAPS = ['downtown', 'cargo_docks', 'sky_rink', 'aurora_outpost'];

async function testMap(mapId) {
  console.log(`\n=== Testing Map: ${mapId} ===`);
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu-sandbox',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--window-size=1280,720',
    '--user-data-dir=C:\\Users\\Mechrevo\\AppData\\Local\\Temp\\edge_debug_' + mapId,
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 1500));

  await new Promise((resolve, reject) => {
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
            return new Promise((res, rej) => {
              pendingCallbacks.set(reqId, { resolve: res, reject: rej });
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
              const text = msg.params.args.map(a => a.value ?? a.description ?? JSON.stringify(a)).join(' ');
              if (msg.params.type === 'error' || text.toLowerCase().includes('error') || text.toLowerCase().includes('warn')) {
                console.log(`[Console ${msg.params.type}]:`, text);
              }
            } else if (msg.method === 'Runtime.exceptionThrown') {
              console.error('[Exception]:', JSON.stringify(msg.params.exceptionDetails));
            }
          };

          await new Promise(r => setTimeout(r, 2000));
          await send('Runtime.evaluate', { expression: `document.querySelector('#btn-title-play')?.click()` });
          await new Promise(r => setTimeout(r, 1000));

          // Select map
          await send('Runtime.evaluate', {
            expression: `
              (() => {
                const mapBtn = document.querySelector('[data-map="${mapId}"]');
                if (mapBtn) mapBtn.click();
              })()
            `
          });
          await new Promise(r => setTimeout(r, 500));

          // Click solo practice
          await send('Runtime.evaluate', {
            expression: `(document.querySelector('#btn-dock-solo') || document.querySelector('#btn-ready'))?.click()`
          });

          // Wait 3.5s for countdown and game load
          await new Promise(r => setTimeout(r, 3500));

          const screenshot = await send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(`c:\\Users\\Mechrevo\\Downloads\\splatoon\\screenshot_${mapId}.png`, Buffer.from(screenshot.data, 'base64'));
          console.log(`Saved screenshot_${mapId}.png`);

          ws.close();
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          edge.kill();
        }
      });
    });
    req.on('error', (e) => {
      edge.kill();
      reject(e);
    });
    req.end();
  });
}

async function main() {
  for (const m of MAPS) {
    try {
      await testMap(m);
    } catch (e) {
      console.error('Failed map:', m, e);
    }
  }
  process.exit(0);
}

main();
