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
        console.log('Target created:', target.webSocketDebuggerUrl);
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
          console.log('Connected to CDP');
          await send('Runtime.enable');
          await send('Log.enable');
          await send('Network.enable');
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
          } else if (msg.method === 'Runtime.exceptionThrown') {
            console.error('[Browser Exception]:', JSON.stringify(msg.params.exceptionDetails));
          }
        };

        await new Promise(r => setTimeout(r, 2000));

        // Click title play
        await send('Runtime.evaluate', {
          expression: `document.querySelector('#btn-title-play')?.click()`
        });

        await new Promise(r => setTimeout(r, 1000));

        // Click solo practice
        await send('Runtime.evaluate', {
          expression: `(document.querySelector('#btn-dock-solo') || document.querySelector('#btn-solo-practice') || document.querySelector('#btn-ready'))?.click()`
        });

        // Wait 3 seconds for countdown or match to start
        await new Promise(r => setTimeout(r, 3500));

        // Also shoot once or look around
        await send('Runtime.evaluate', {
          expression: `
            // Check canvas pixels
            (() => {
              const canvas = document.querySelector('#webgl-canvas');
              const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
              const pixels = new Uint8Array(4 * 10 * 10);
              gl.readPixels(canvas.width / 2 - 5, canvas.height / 2 - 5, 10, 10, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
              let nonZero = 0;
              for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i] > 20 || pixels[i+1] > 20 || pixels[i+2] > 20) nonZero++;
              }
              return { nonZeroPixels: nonZero, sample: Array.from(pixels.slice(0, 16)) };
            })()
          `,
          returnByValue: true
        }).then(res => console.log('Pixel sample:', res));

        const screenshot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync('c:\\Users\\Mechrevo\\Downloads\\splatoon\\screenshot.png', Buffer.from(screenshot.data, 'base64'));
        console.log('Saved screenshot.png');

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
