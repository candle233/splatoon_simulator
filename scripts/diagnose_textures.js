import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function diagnose() {
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu-sandbox',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--window-size=1280,720',
    '--user-data-dir=C:\\Users\\Mechrevo\\AppData\\Local\\Temp\\edge_debug_diag',
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
          };

          await new Promise(r => setTimeout(r, 2000));
          await send('Runtime.evaluate', { expression: `document.querySelector('#btn-title-play')?.click()` });
          await new Promise(r => setTimeout(r, 1000));
          await send('Runtime.evaluate', {
            expression: `(document.querySelector('#btn-dock-solo') || document.querySelector('#btn-ready'))?.click()`
          });

          // Wait 6 seconds
          await new Promise(r => setTimeout(r, 6000));

          // Inspect window.game textures
          const evalResult = await send('Runtime.evaluate', {
            expression: `
              (() => {
                const arena = window.game?.arena;
                if (!arena) return { error: 'no arena' };
                const details = [];
                arena.group.traverse((obj) => {
                  if (obj.isMesh && obj.material) {
                    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                    for (const m of mats) {
                      if (m.map) {
                        const img = m.map.image;
                        details.push({
                          objName: obj.name,
                          matType: m.type,
                          mapType: m.map.constructor.name,
                          imgType: img ? img.constructor.name : null,
                          src: img?.src || null,
                          isCanvas: img instanceof HTMLCanvasElement,
                          w: img?.width,
                          h: img?.height
                        });
                      }
                    }
                  }
                });
                return details;
              })()
            `,
            returnByValue: true
          });
          console.log('Meshes with map:', JSON.stringify(evalResult.result.value?.slice(0, 20), null, 2));

          const screenshot = await send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync('c:\\Users\\Mechrevo\\Downloads\\splatoon\\screenshot_diag_6s.png', Buffer.from(screenshot.data, 'base64'));
          console.log('Saved screenshot_diag_6s.png');

          ws.close();
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          edge.kill();
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

diagnose().catch(console.error);
