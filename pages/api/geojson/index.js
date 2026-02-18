import fs from 'fs';
import path from 'path';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

const GEOJSON_DIR = path.join(process.cwd(), 'public', 'geojson');

function ensureDir() {
  if (!fs.existsSync(GEOJSON_DIR)) {
    fs.mkdirSync(GEOJSON_DIR, { recursive: true });
  }
}

export default function handler(req, res) {
  ensureDir();

  if (req.method === 'GET') {
    try {
      const files = fs.readdirSync(GEOJSON_DIR).filter(
        (f) => !f.startsWith('_') && (f.endsWith('.geojson') || f.endsWith('.json'))
      );

      const result = files.map((filename) => {
        const filePath = path.join(GEOJSON_DIR, filename);
        const stat = fs.statSync(filePath);
        return {
          filename,
          url: `/geojson/${filename}`,
          size: stat.size,
          uploadedAt: stat.mtime.toISOString(),
        };
      });

      return res.status(200).json(result);
    } catch (err) {
      console.error('Error listing geojson files:', err);
      return res.status(500).json({ error: 'Failed to list files' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { filename, data } = req.body;

      if (!filename || !data) {
        return res.status(400).json({ error: 'filename and data are required' });
      }

      const safeName = filename.replace(/[^a-zA-Z0-9._\-ก-๙]/g, '_');
      const finalName = safeName.endsWith('.geojson') || safeName.endsWith('.json')
        ? safeName
        : `${safeName}.geojson`;

      const filePath = path.join(GEOJSON_DIR, finalName);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

      return res.status(200).json({
        success: true,
        filename: finalName,
        url: `/geojson/${finalName}`,
      });
    } catch (err) {
      console.error('Error saving geojson file:', err);
      return res.status(500).json({ error: 'Failed to save file' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { filename } = req.body;

      if (!filename) {
        return res.status(400).json({ error: 'filename is required' });
      }

      const safeName = path.basename(filename);
      const filePath = path.join(GEOJSON_DIR, safeName);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      fs.unlinkSync(filePath);
      return res.status(200).json({ success: true, deleted: safeName });
    } catch (err) {
      console.error('Error deleting geojson file:', err);
      return res.status(500).json({ error: 'Failed to delete file' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
