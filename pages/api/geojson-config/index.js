import fs from 'fs';
import path from 'path';

const GEOJSON_DIR = path.join(process.cwd(), 'public', 'geojson');
const CONFIG_FILE = path.join(GEOJSON_DIR, '_layer-config.json');

function ensureDir() {
  if (!fs.existsSync(GEOJSON_DIR)) {
    fs.mkdirSync(GEOJSON_DIR, { recursive: true });
  }
}

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const data = JSON.parse(raw);
      return typeof data === 'object' && data !== null ? data : {};
    }
  } catch { /* ignore */ }
  return {};
}

export default function handler(req, res) {
  ensureDir();

  if (req.method === 'GET') {
    try {
      const config = readConfig();
      return res.status(200).json(config);
    } catch (err) {
      console.error('Error reading layer config:', err);
      return res.status(500).json({ error: 'Failed to read config' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { config } = req.body;
      if (!config || typeof config !== 'object') {
        return res.status(400).json({ error: 'config object is required' });
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Error saving layer config:', err);
      return res.status(500).json({ error: 'Failed to save config' });
    }
  }

  return res.status(405).json({ method: 'Method not allowed' });
}
