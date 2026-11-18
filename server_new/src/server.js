// Start des Dienstes. Spricht nur HTTP, HTTPS macht Caddy davor.

const http = require('node:http');
const path = require('node:path');
const { createApp } = require('./app');

const secret = process.env.SERVER_SECRET || '';
if (secret.length < 32) {
  console.error('SERVER_SECRET fehlt oder ist kürzer als 32 Zeichen. Siehe .env.example.');
  process.exit(1);
}

const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
if (!publicUrl.startsWith('http')) {
  console.error('PUBLIC_URL fehlt (z.B. https://calendar.panumic.com).');
  process.exit(1);
}

const port = parseInt(process.env.APP_PORT, 10);
if (!port) {
  console.error('APP_PORT fehlt.');
  process.exit(1);
}

const app = createApp({
  dbFile: process.env.DB_FILE || '/data/calendar.db',
  secret: secret,
  publicUrl: publicUrl,
  trustProxy: process.env.TRUST_PROXY === 'true',
  publicDir: path.join(__dirname, '..', 'public')
});

const server = http.createServer(app.handle);
server.listen(port, '0.0.0.0', () => console.log('Klassenkalender hört auf Port ' + port));

function stop() {
  server.close(() => {
    app.close();
    process.exit(0);
  });
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
