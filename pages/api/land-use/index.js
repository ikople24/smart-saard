import fs from 'fs';
import path from 'path';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const DATA_DIR = path.join(process.cwd(), 'public', 'geojson');
const DATA_FILE = path.join(DATA_DIR, '_land-use-data.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readData() {
  ensureDir();
  if (!fs.existsSync(DATA_FILE)) {
    return { assignments: {}, updatedAt: null };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return { assignments: {}, updatedAt: null };
  }
}

function writeData(data) {
  ensureDir();
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export default function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const data = readData();
      return res.status(200).json(data);
    } catch (err) {
      console.error('Error reading land use data:', err);
      return res.status(500).json({ error: 'Failed to read data' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { parcelCode, landUse } = req.body;

      if (!parcelCode) {
        return res.status(400).json({ error: 'parcelCode is required' });
      }

      const data = readData();

      const isEmpty = !landUse || landUse === '' || (Array.isArray(landUse) && landUse.length === 0);
      if (isEmpty) {
        delete data.assignments[parcelCode];
      } else {
        data.assignments[parcelCode] = landUse;
      }

      writeData(data);
      return res.status(200).json({ success: true, assignments: data.assignments });
    } catch (err) {
      console.error('Error saving land use data:', err);
      return res.status(500).json({ error: 'Failed to save data' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { assignments } = req.body;

      if (!assignments || typeof assignments !== 'object') {
        return res.status(400).json({ error: 'assignments object is required' });
      }

      const data = readData();
      Object.assign(data.assignments, assignments);

      Object.keys(data.assignments).forEach((k) => {
        if (!data.assignments[k] || data.assignments[k] === '') {
          delete data.assignments[k];
        }
      });

      writeData(data);
      return res.status(200).json({ success: true, assignments: data.assignments });
    } catch (err) {
      console.error('Error bulk-saving land use data:', err);
      return res.status(500).json({ error: 'Failed to save data' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
