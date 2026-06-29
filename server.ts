import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';

const app = express();
const port = 3001;
const DATA_FILE = path.join(process.cwd(), 'scans.json');
const MATCH_DATA_FILE = path.join(process.cwd(), 'matches.json');
const KLANTEN_DATA_FILE = path.join(process.cwd(), 'klanten.json');

app.use(cors({
  origin: function (origin, callback) {
    // Sta localhost en het productiedomein toe (optioneel kan dit strenger via .env)
    if (!origin || origin.startsWith('http://localhost:') || origin.includes('woonwensmakelaar')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json({ limit: '10mb' })); // Limiet om grote webhook payloads te voorkomen


// Firebase Admin SDK Initialisatie
const serviceAccountPath = path.join(process.cwd(), 'firebase-admin.json');
if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("🔥 Firebase Admin SDK succesvol geïnitialiseerd!");
  }
} else {
  console.warn("⚠️ Waarschuwing: firebase-admin.json is niet gevonden. Firestore matches zullen niet laden.");
}
const dbAdmin = admin.apps.length ? admin.firestore() : null;

// 1. Initialiseer bestanden
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(MATCH_DATA_FILE)) fs.writeFileSync(MATCH_DATA_FILE, JSON.stringify({ matches: [] }, null, 2));
if (!fs.existsSync(KLANTEN_DATA_FILE)) fs.writeFileSync(KLANTEN_DATA_FILE, JSON.stringify({ klanten: [] }, null, 2));

// Auth Middleware voor API endpoints
app.use('/api', async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Geen geldige token gevonden' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    if (!admin.apps.length) {
      throw new Error("Firebase Admin niet geïnitialiseerd");
    }
    const decodedToken = await admin.auth().verifyIdToken(token);
    (req as any).user = decodedToken;
    next();
  } catch (err) {
    console.error("Token validatie fout:", err);
    return res.status(403).json({ error: 'Forbidden: Ongeldige token' });
  }
});

// Webhook Auth Middleware
const webhookAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const providedSecret = req.headers['x-api-key'] || req.query.key;
    if (providedSecret !== secret) {
      return res.status(403).json({ error: 'Forbidden: Ongeldige webhook secret' });
    }
  }
  next();
};


// SSE clients voor real-time matches updates
let matchSseClients: any[] = [];

function broadcastMatchUpdate(match: any) {
  const payload = JSON.stringify(match);
  matchSseClients.forEach(client => {
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch (_) {}
  });
}

// 2. Helper voor PDOK Wijk Lookup
async function getOfficialWijk(adres: string, plaats: string): Promise<string> {
  try {
    const rawQuery = `${adres}, ${plaats}`;
    console.log(`Searching PDOK v3.1 for: ${rawQuery}`);
    const suggestUrl = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/suggest?q=${encodeURIComponent(rawQuery)}&rows=1`;
    const suggestRes = await fetch(suggestUrl);
    const suggestData: any = await suggestRes.json();

    if (suggestData && suggestData.response && suggestData.response.docs && suggestData.response.docs.length > 0) {
      const doc = suggestData.response.docs[0];
      const lookupUrl = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/lookup?id=${doc.id}`;
      const lookupRes = await fetch(lookupUrl);
      const lookupData: any = await lookupRes.json();
      
      if (lookupData && lookupData.response && lookupData.response.docs && lookupData.response.docs.length > 0) {
        const docInfo = lookupData.response.docs[0];
        const wijkRaw = docInfo.buurtnaam || docInfo.wijknaam || 'Onbekend';
        return wijkRaw.replace(/^Wijk \d+ /i, ''); 
      }
    }
  } catch (error) {
    console.error('PDOK Fetch Error:', error);
  }
  return 'Wijk onbekend';
}

// 3. GET APIs
app.get('/api/scans', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Fout bij inladen scans' });
  }
});

app.get('/api/firestore-scans', async (req, res) => {
  try {
    if (!dbAdmin) {
      return res.status(500).json({ error: 'Firestore Admin is niet geconfigureerd' });
    }
    
    console.log("📡 Scans ophalen uit Firestore...");
    const scansRef = dbAdmin.collection('NieuweHuizenPerScrape');
    const snapshot = await scansRef.get();
    
    const scans: any[] = [];
    snapshot.forEach(doc => {
      scans.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json(scans);
  } catch (error) {
    console.error('Error fetching firestore scans in backend:', error);
    res.status(500).json({ error: 'Fout bij ophalen scans uit Firestore' });
  }
});

// --- Tasks endpoints (Bypasses web SDK firestore rules restriction via Admin SDK) ---
app.get('/api/tasks', async (req, res) => {
  try {
    if (!dbAdmin) {
      return res.status(500).json({ error: 'Firestore Admin is niet geconfigureerd' });
    }
    console.log("📡 Taken ophalen uit Firestore...");
    const tasksRef = dbAdmin.collection('tasks');
    const snapshot = await tasksRef.get();
    
    const tasks: any[] = [];
    snapshot.forEach(doc => {
      tasks.push({
        id: doc.id,
        ...doc.data()
      });
    });
    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Fout bij ophalen taken' });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    if (!dbAdmin) {
      return res.status(500).json({ error: 'Firestore Admin is niet geconfigureerd' });
    }
    const { text, done, type, dueDate, dueTime } = req.body;
    if (typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is verplicht en moet een string zijn' });
    }
    console.log(`➕ Taak toevoegen: "${text}"`);
    const tasksRef = dbAdmin.collection('tasks');
    const taskData: any = {
      text,
      done: !!done,
      type: type || 'taak',
      createdAt: new Date().toISOString()
    };
    if (dueDate) taskData.dueDate = dueDate;
    if (dueTime) taskData.dueTime = dueTime;
    if (req.body.klant) taskData.klant = req.body.klant;
    if (req.body.woning) taskData.woning = req.body.woning;
    if (req.body.project) taskData.project = req.body.project;
    const docRef = await tasksRef.add(taskData);
    res.json({ id: docRef.id, ...taskData });
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Fout bij aanmaken taak' });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  try {
    if (!dbAdmin) {
      return res.status(500).json({ error: 'Firestore Admin is niet geconfigureerd' });
    }
    const { id } = req.params;
    const { text, done, type, dueDate, dueTime } = req.body;
    console.log(`✏️ Taak bijwerken: ${id}`);
    const taskRef = dbAdmin.collection('tasks').doc(id);
    const updateData: any = {};
    if (text !== undefined) updateData.text = text;
    if (done !== undefined) updateData.done = !!done;
    if (type !== undefined) updateData.type = type;
    if (dueDate !== undefined) updateData.dueDate = dueDate;
    if (dueTime !== undefined) updateData.dueTime = dueTime;
    if (req.body.klant !== undefined) updateData.klant = req.body.klant;
    if (req.body.woning !== undefined) updateData.woning = req.body.woning;
    if (req.body.project !== undefined) updateData.project = req.body.project;
    await taskRef.update(updateData);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Fout bij bijwerken taak' });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    if (!dbAdmin) {
      return res.status(500).json({ error: 'Firestore Admin is niet geconfigureerd' });
    }
    const { id } = req.params;
    console.log(`🗑️ Taak verwijderen: ${id}`);
    const taskRef = dbAdmin.collection('tasks').doc(id);
    await taskRef.delete();
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Fout bij verwijderen taak' });
  }
});

app.get('/api/matches', async (req, res) => {
  try {
    if (!dbAdmin) {
      return res.status(500).json({ error: 'Firestore Admin is niet geconfigureerd' });
    }
    
    console.log("📡 Matches ophalen uit Firestore...");
    const matchesRef = dbAdmin.collection('matches');
    const snapshot = await matchesRef.get();
    
    const runs: any[] = [];
    
    snapshot.forEach(doc => {
      const docId = doc.id; // e.g. "2026-05-18_07-16"
      const docData = doc.data();
      const rawMatchesArray = docData.data || [];
      
      // Map the raw matches to match the frontend expected Match schema
      const mappedMatches = rawMatchesArray.map((m: any, index: number) => {
        const matchPercentage = parseInt(m.match_percentage) || 0;
        
        // Construct matchCriteria
        const matchCriteria = [
          {
            label: "📍 Regio",
            client: m.zoekgebied_klant || 'Niet gespecificeerd',
            house: `${m.adres || ''} (${m.afstand_zoekgebied === 'ja' ? 'ja' : m.afstand_zoekgebied === 'nee (dichtbij)' ? 'dichtbij' : m.afstand_zoekgebied || 'nee'})`,
            match: m.afstand_zoekgebied === 'ja'
          },
          {
            label: "💰 Budget",
            client: m.budget_range || 'Niet gespecificeerd',
            house: `€ ${m.prijs ? m.prijs.toLocaleString('nl-NL') : 'onbekend'} · ${m.prijs_binnen_budget === 'ja' ? 'ja' : 'nee'}`,
            match: m.prijs_binnen_budget === 'ja'
          },
          {
            label: "🏠 Woningtype",
            client: m.woning_type_klant_prof || 'Geen voorkeur',
            house: m.woning_type_adres || 'Niet gespecificeerd',
            match: (m.woning_type_klant_prof || 'geen voorkeur').toLowerCase() === 'geen voorkeur' || 
                   (m.woning_type_adres || '').toLowerCase() === (m.woning_type_klant_prof || '').toLowerCase()
          },
          {
            label: "🏘️ Woningsoort",
            client: m.woning_soort_klant_prof || 'Geen voorkeur',
            house: m.woning_soort_adres || 'Niet gespecificeerd',
            match: (m.woning_soort_klant_prof || 'geen voorkeur').toLowerCase() === 'geen voorkeur' || 
                   (m.woning_soort_adres || '').toLowerCase() === (m.woning_soort_klant_prof || '').toLowerCase()
          },
          {
            label: "✨ Bijzonderheden",
            client: m.bijzondere_kenmerken_klant_prof || 'Geen specifieke wensen',
            house: m.bijzondere_kenmerken || 'Geen bijzondere kenmerken',
            match: true
          }
        ];

        // Bepaal eerst de datum van de run via de docId als solide fallback (bijv. "2026-05-18_07-16")
        let runDateStr = new Date().toISOString();
        const dateMatch = docId.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})$/);
        if (dateMatch) {
          const [_, y, m, d, hh, mm] = dateMatch;
          runDateStr = new Date(`${y}-${m}-${d}T${hh}:${mm}:00`).toISOString();
        }

        // Robuust datum-uitlezen per match
        let matchDateStr = runDateStr; 
        if (m.datum) {
          if (typeof m.datum.toDate === 'function') {
            matchDateStr = m.datum.toDate().toISOString();
          } else if (m.datum.seconds !== undefined && m.datum.seconds !== null) {
            matchDateStr = new Date(m.datum.seconds * 1000).toISOString();
          } else if (m.datum._seconds !== undefined && m.datum._seconds !== null) {
            matchDateStr = new Date(m.datum._seconds * 1000).toISOString();
          } else if (typeof m.datum === 'string') {
            matchDateStr = m.datum;
          } else {
            const d = new Date(m.datum);
            if (!isNaN(d.getTime())) {
              matchDateStr = d.toISOString();
            }
          }
        }

        return {
          id: `fs-${docId}-${index}`,
          clientName: m.naam_klant || 'Onbekende Klant',
          address: m.adres || 'Onbekend Adres',
          matchPercentage,
          reason: m.analyse || '',
          shortSummary: `Vraagprijs: € ${m.prijs ? m.prijs.toLocaleString('nl-NL') : 'onbekend'}`,
          features: m.bijzondere_kenmerken ? [m.bijzondere_kenmerken] : [],
          link: m.link_woning || '',
          makelaar: 'Zie link',
          matchCriteria,
          datum: matchDateStr
        };
      });
      
      // Determine overall run date from first match's date or parsed docId
      let runDateStr = new Date().toISOString();
      const dateMatch = docId.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})$/);
      if (dateMatch) {
        const [_, y, m, d, hh, mm] = dateMatch;
        runDateStr = new Date(`${y}-${m}-${d}T${hh}:${mm}:00`).toISOString();
      }

      if (mappedMatches.length > 0 && mappedMatches[0].datum) {
        runDateStr = mappedMatches[0].datum;
      }
      
      runs.push({
        id: docId,
        matches: mappedMatches,
        datum: runDateStr
      });
    });
    
    // Sort runs descending by ID
    runs.sort((a, b) => b.id.localeCompare(a.id));
    
    res.json({ runs });
  } catch (err: any) {
    console.error('Fout bij ophalen matches uit Firestore:', err);
    res.status(500).json({ error: 'Fout bij ophalen matches uit Firestore: ' + err.message });
  }
});

app.get('/api/klanten', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(KLANTEN_DATA_FILE, 'utf-8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Fout bij inladen klanten' });
  }
});

const N8N_KLANTEN_WEBHOOK = 'https://woonwensmakelaar.app.n8n.cloud/webhook/69dda1df-46e0-4fc4-bcb8-cade9d33f5a8';

app.get('/api/fetch-klanten', async (req, res) => {
  try {
    console.log('📡 Ophalen van n8n klanten profielen...');
    // Request n8n workflow data
    const n8nRes = await fetch(N8N_KLANTEN_WEBHOOK, { method: 'GET' });
    const n8nBody: any = await n8nRes.json();
    
    // n8n returns array of arrays if from google sheets node
    // Let's assume it returns an array of objects
    if (Array.isArray(n8nBody) && n8nBody.length > 0) {
      fs.writeFileSync(KLANTEN_DATA_FILE, JSON.stringify({ klanten: n8nBody }, null, 2));
      return res.json({ status: 'success', fetched: n8nBody.length, klanten: n8nBody });
    } else if (n8nBody.message && n8nBody.message.includes('Unused Respond to Webhook')) {
      return res.status(200).json({ status: 'webhook_error', message: 'N8N Webhook is getriggerd, maar geeft geen data terug. Voeg een Respond to Webhook node toe!' });
    }
    
    res.json({ status: 'no_data', message: 'Geen herkenbare data ontvangen', raw: n8nBody });
  } catch (err: any) {
    console.error('Fout bij ophalen n8n klanten profielen:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// LET OP: Hiervoor moet de gebruiker een POST webhook aanmaken in N8N.
const N8N_ADD_KLANT_WEBHOOK = 'https://woonwensmakelaar.app.n8n.cloud/webhook/e4488576-ecab-4b82-8196-b3922eba62de'; // Actieve Toevoegen Webhook

app.post('/api/add-klant', async (req, res) => {
  try {
    const newKlant = req.body;
    console.log('📡 Nieuw klantprofiel toevoegen via N8N...', newKlant);
    
    // We roepen de webhook aan (die de gebruiker idealiter bouwt om in Google Sheets te schrijven)
    const n8nRes = await fetch(N8N_ADD_KLANT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newKlant)
    });
    
    if (n8nRes.ok) {
       res.json({ status: 'success', message: 'Klant doorgezet naar N8N' });
    } else {
       res.status(500).json({ status: 'error', message: 'N8N gaf een foutmelding.' });
    }
  } catch (err: any) {
    console.error('Fout bij toevoegen klant:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// SSE stream endpoint voor real-time match updates
app.get('/api/matches/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Stuur een hartslag elke 25 seconden om de verbinding actief te houden
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) {}
  }, 25000);

  const clientId = Date.now();
  matchSseClients.push({ id: clientId, res });
  console.log(`📡 SSE client verbonden voor matches (id: ${clientId}), totaal: ${matchSseClients.length}`);

  req.on('close', () => {
    clearInterval(heartbeat);
    matchSseClients = matchSseClients.filter(c => c.id !== clientId);
    console.log(`📡 SSE client verbroken (id: ${clientId}), totaal: ${matchSseClients.length}`);
  });
});

// 4. Helper: parseer n8n bullet-tekst naar gestructureerde match objecten
function parseN8nMatches(tekst: string, datum: string): any[] {
  const matches: any[] = [];
  // Splits op dubbele nieuwe regels om de verschillende matches te scheiden
  const blokken = tekst.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);

  for (const blok of blokken) {
    const lines = blok.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    // Eerste regel: "Naam — Adres, Stad — match XX%" (of met een - aan het begin)
    // We maken de - aan het begin en het woord 'match' optioneel
    const headerMatch = lines[0].match(/^-?\s*(.+?)\s+—\s+(.+?)\s+—\s+(?:match\s+)?(\d+)%/i);
    if (!headerMatch) {
      console.log('Skipping line (no header match):', lines[0]);
      continue;
    }

    const clientName = headerMatch[1].trim();
    const address    = headerMatch[2].trim();
    const pct        = parseInt(headerMatch[3]);

    // Link zoeken: die kan beginnen met "- Link:" of "Link:"
    const linkLine = lines.find(l => l.toLowerCase().includes('link:'));
    let link = '';
    if (linkLine) {
      const parts = linkLine.split(/link:/i);
      if (parts.length > 1) link = parts[1].trim();
    }

    // Reden = alle overige regels (zonder de header en de link-regel)
    const reasonLines = lines.slice(1).filter(l => !l.toLowerCase().includes('link:'));
    const reason = reasonLines.join(' ').replace(/\s+/g, ' ').trim();

    // Extraheer prijs uit reden als aanwezig (bijv. "Prijs €315.000")
    const prijsMatch = reason.match(/Prijs\s+(€[\d.,]+)/i);
    const prijs = prijsMatch ? prijsMatch[1] : '';

    matches.push({
      id: `n8n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      clientName,
      address,
      matchPercentage: pct,
      reason,
      link,
      makelaar: 'Zie link',
      shortSummary: prijs ? `Vraagprijs: ${prijs}` : 'Zie analyse',
      // Features: probeer de bullets te gebruiken of splits op komma's
      features: reasonLines.map(l => l.replace(/^[-*]\s*/, '').trim()).filter(l => l.length > 3),
      matchCriteria: [],
      datum,
    });
  }

  return matches;
}

// 4b. Helper: parseer de NIEUWE gestructureerde JSON array van N8N naar ons Match formaat (met twee kolommen)
function parseStructuredN8nMatches(sourceArray: any[], datum: string): any[] {
  return sourceArray.map((item: any) => {
    let percentage = 0;
    const rawPct = item["match %"];
    if (typeof rawPct === 'number') {
      percentage = rawPct <= 1 && rawPct > 0 ? Math.round(rawPct * 100) : Math.round(rawPct);
    } else {
      const pctStr = String(rawPct || "0%");
      let parsed = parseInt(pctStr.replace(/\D/g, '')) || 0;
      // if string was "0.8", parsed becomes 8, so we fix that:
      if (pctStr.includes('.') && parsed < 10) parsed *= 10;
      percentage = parsed <= 1 && parsed > 0 ? Math.round(parsed * 100) : Math.round(parsed);
      if (percentage > 100) percentage = Math.floor(percentage / 10); // fallback for weird anomalies
    }
    
    // Bepaal de match-statussen (true/false) gebaseerd op de tekst in de JSON
    const isRegionMatch = (item["afstand zoekgebied"] || '').toLowerCase().includes("ja") || (item["afstand zoekgebied"] || '').toLowerCase().includes("dichtbij");
    const isBudgetMatch = (item["prijs binnen budget"] || '').toLowerCase().includes("ja");
    const isWoningtypeMatch = !(item["woning type"] || '').toLowerCase().includes("nadeel") && !(item["woning type"] || '').toLowerCase().includes("mismatch");

    return {
      id: `n8n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      clientName: item["naam klant"] || 'Onbekend',
      address: item["adres"] || 'Onbekend adres',
      matchPercentage: percentage,
      reason: item["analyse"] || '',
      link: item["link woning"] || '',
      makelaar: 'Zie link',
      shortSummary: item["prijs"] ? `Vraagprijs: ${item["prijs"]}` : 'Zie analyse',
      features: [],
      matchCriteria: [
        {
          label: "📍 Regio",
          client: item["zk geb. klant"] || '-',
          house: `${item["adres"] ? item["adres"].split(',').pop()?.trim() || item["adres"] : '-'} (${item["afstand zoekgebied"] || '-'})`,
          match: isRegionMatch
        },
        {
          label: "💰 Budget",
          client: item["budget range"] || '-',
          house: `${item["prijs"] || '-'} · ${item["prijs binnen budget"] || '-'}`,
          match: isBudgetMatch
        },
        {
          label: "🏠 Woningtype",
          client: item["woning type klnt prof"] || '-',
          house: item["woning type"] || '-',
          match: isWoningtypeMatch
        },
        {
          label: "✨ Bijzonderheden",
          client: item["bijzondere kenmerken klnt prof"] || '-',
          house: item["bijzondere kenmerken"] || '-',
          match: true
        }
      ],
      datum
    };
  });
}

// 5. POST Webhooks
app.post('/webhook', webhookAuth, async (req, res) => {
  try {
    const data = req.body;
    console.log('--- Nieuwe Scan Webhook ontvangen ---');
    const houses = Array.isArray(data) ? data : [data];
    console.log(`📡 Verwerken van ${houses.length} huiz(en)`);

    const scans = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    let addedCount = 0;

    for (const house of houses) {
      if (!house.adres || !house.Plaats) continue;

      // Duplicate check
      const exists = scans.find((s: any) => s.adres === house.adres && s.Plaats === house.Plaats);
      if (exists) continue;

      // Verrijk met wijk
      if (!house.Wijk || house.Wijk === 'Onbekend') {
        house.Wijk = await getOfficialWijk(house.adres, house.Plaats);
      }

      // Default waarden
      house.status = house.status || house.satus || 'Beschikbaar';
      house.m2 = (house.m2 || '--').toString().replace(/&#178;/g, '²');
      house["m2 perseel"] = (house["m2 perseel"] || '--').toString().replace(/&#178;/g, '²');
      house.Prijs = house.Prijs || 'Prijs op aanvraag';
      house.Makelaar = house.Makelaar || 'Onbekende Makelaar';
      if (!house.Datum) house.Datum = new Date().toLocaleDateString('nl-NL');

      scans.unshift(house);
      addedCount++;
    }

    if (addedCount > 0) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(scans, null, 2));
    }

    res.json({ status: 'success', added: addedCount, total: scans.length });
  } catch (err) {
    console.error('Webhook Error:', err);
    res.status(500).json({ status: 'error' });
  }
});

// Handmatig gestructureerde match (zoals eerder)
app.post('/webhook-match', webhookAuth, async (req, res) => {
  try {
    const match = req.body;
    console.log('--- Nieuwe Match Webhook ---');
    
    if (match.address && (!match.wijk || match.wijk === 'Onbekend')) {
       const parts = match.address.split(',');
       const adres = parts[0]?.trim();
       const plaats = parts[1]?.trim() || '';
       match.wijk = await getOfficialWijk(adres, plaats);
    }

    const data = JSON.parse(fs.readFileSync(MATCH_DATA_FILE, 'utf-8'));
    data.matches.unshift(match);
    fs.writeFileSync(MATCH_DATA_FILE, JSON.stringify(data, null, 2));
    
    broadcastMatchUpdate(match);
    console.log(`📢 Match broadcast naar ${matchSseClients.length} SSE client(s)`);
    
    res.json({ status: 'success', wijk: match.wijk });
  } catch (err) {
    res.status(500).json({ status: 'error' });
  }
});

// n8n match webhook — ontvangt het raw n8n formaat met tekst-matches
app.post('/webhook-n8n-match', webhookAuth, async (req, res) => {
  try {
    const body = req.body;
    console.log('--- n8n Match Webhook ontvangen ---');
    console.log('Body keys:', Object.keys(body));

    let parsedMatches: any[] = [];
    const datum: string = new Date().toISOString();
    if (Array.isArray(body) && body.length > 0 && typeof body[0] === 'object' && body[0]["naam klant"]) {
       parsedMatches = parseStructuredN8nMatches(body, datum);
    } else {
       const matchTekst: string = body.matches || body.output || body.text || '';
       if (!matchTekst) {
         return res.status(400).json({ status: 'error', message: 'Geen matches tekst of JSON array gevonden in body' });
       }
       parsedMatches = parseN8nMatches(matchTekst, datum);
    }
    console.log(`✅ ${parsedMatches.length} matches geparsed uit n8n response`);

    const data = JSON.parse(fs.readFileSync(MATCH_DATA_FILE, 'utf-8'));
    data.matches = data.matches.filter((m: any) => !String(m.id ?? '').startsWith('n8n-') || (m.datum ?? '').slice(0,10) !== datum.slice(0,10));
    data.matches = [...parsedMatches, ...data.matches];
    fs.writeFileSync(MATCH_DATA_FILE, JSON.stringify(data, null, 2));

    parsedMatches.forEach(m => broadcastMatchUpdate(m));
    console.log(`📢 ${parsedMatches.length} matches broadcast naar ${matchSseClients.length} SSE client(s)`);

    res.json({ status: 'success', parsed: parsedMatches.length, matches: parsedMatches });
  } catch (err) {
    console.error('n8n webhook fout:', err);
    res.status(500).json({ status: 'error' });
  }
});

// Poll n8n productie webhooks en verwerk de response
const N8N_WEBHOOK_URL = 'https://woonwensmakelaar.app.n8n.cloud/webhook/d20bd156-86c9-40ea-86aa-f92949d207e7match';
const N8N_SCANS_WEBHOOK_URL = 'https://woonwensmakelaar.app.n8n.cloud/webhook/d20bd156-86c9-40ea-86aa-f92949d207e7';

app.get('/api/fetch-n8n-scans', async (req, res) => {
  try {
    console.log('📡 Ophalen van n8n scans...');
    const n8nRes = await fetch(N8N_SCANS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'fetch_latest', source: 'WoonWensManager' })
    });

    const n8nBody: any = await n8nRes.json();
    console.log('n8n response status:', n8nRes.status);
    
    let houses = [];
    if (Array.isArray(n8nBody)) {
        houses = n8nBody;
    } else if (typeof n8nBody === 'object' && n8nBody !== null) {
        if (n8nBody.data && Array.isArray(n8nBody.data)) {
             houses = n8nBody.data;
        } else {
             houses = [n8nBody];
        }
    }

    if (!houses || houses.length === 0 || !houses[0].adres) {
      return res.status(200).json({ status: 'no_data', raw: n8nBody, message: 'n8n gaf geen scans terug of in verkeerd formaat' });
    }

    let processed = [];
    for (const house of houses) {
        if (!house.adres || !house.Plaats) continue;
        if (!house.Wijk || house.Wijk === 'Onbekend') {
          house.Wijk = await getOfficialWijk(house.adres, house.Plaats);
        }
        house.status = house.status || house.satus || 'Beschikbaar';
        house.m2 = (house.m2 || '--').toString().replace(/&#178;/g, '²');
        house["m2 perseel"] = (house["m2 perseel"] || '--').toString().replace(/&#178;/g, '²');
        Object.keys(house).forEach(k => {
           if (k.toLowerCase().includes('prijs')) {
               house.Prijs = house[k];
           }
        });
        
        // Format Prijs
        if (typeof house.Prijs === 'number') {
            house.Prijs = '€ ' + house.Prijs.toLocaleString('nl-NL');
        } else if (typeof house.Prijs === 'string' && !house.Prijs.includes('€') && !isNaN(Number(house.Prijs))) {
            house.Prijs = '€ ' + Number(house.Prijs).toLocaleString('nl-NL');
        } else if (typeof house.Prijs === 'string' && !house.Prijs.includes('€')) {
            house.Prijs = '€ ' + house.Prijs;
        }
        
        house.Prijs = house.Prijs || 'Prijs op aanvraag';
        house.Makelaar = house.Makelaar || 'Onbekende Makelaar';
        if (!house.Datum) house.Datum = new Date().toLocaleDateString('nl-NL');
        processed.push(house);
    }
    
    // We override everything since the user wants *exactly* what the webhook sends
    fs.writeFileSync(DATA_FILE, JSON.stringify(processed, null, 2));
    
    res.json({ status: 'success', fetched: processed.length, scans: processed });
  } catch (err: any) {
    console.error('Fout bij ophalen n8n scans:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/fetch-n8n-matches', async (req, res) => {
  try {
    console.log('📡 Ophalen van n8n matches...');
    const n8nRes = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'fetch_latest', source: 'WoonWensManager' })
    });

    const n8nBody: any = await n8nRes.json();
    console.log('n8n response status:', n8nRes.status);
    
    const datum = new Date().toISOString();
    let parsedMatches: any[] = [];

    if (Array.isArray(n8nBody) && n8nBody.length > 0 && (n8nBody[0]["naam klant"] || n8nBody[0]["adres"] || n8nBody[0]["bijzondere kenmerken"])) {
        parsedMatches = parseStructuredN8nMatches(n8nBody, datum);
    } else {
        const matchTekst: string = n8nBody.matches || n8nBody.output || n8nBody.text || '';
        if (!matchTekst) {
          return res.status(200).json({ status: 'no_data', raw: n8nBody, message: 'n8n gaf geen matches tekst of array terug' });
        }
        parsedMatches = parseN8nMatches(matchTekst, datum);
    }

    // Override the old matches and save the new ones directly
    const data = { matches: parsedMatches };
    fs.writeFileSync(MATCH_DATA_FILE, JSON.stringify(data, null, 2));

    parsedMatches.forEach(m => broadcastMatchUpdate(m));
    console.log(`✅ ${parsedMatches.length} n8n matches geïmporteerd en gebroadcast`);

    res.json({ status: 'success', parsed: parsedMatches.length, matches: parsedMatches });
  } catch (err: any) {
    console.error('Fout bij ophalen n8n matches:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// --- Gemini AI Blog Generation ---
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

app.post('/api/generate-blog-titles', async (req, res) => {
  try {
    if (!ai) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in .env' });
    const { topic } = req.body;
    
    const prompt = `Je bent een ervaren aankoopmakelaar (de Woonwensmakelaar). Bedenk 3 pakkende, professionele blogtitels over het volgende onderwerp: "${topic}". 
De titels moeten aantrekkelijk zijn voor potentiële huizenkopers en focussen op ontzorging, advies, of valkuilen bij de aankoop van een huis. 
Geef de titels als een simpele lijst terug, gescheiden door een nieuwe regel, zonder nummering of opsommingstekens. Zorg dat ze direct klaar zijn voor gebruik.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    
    const text = response.text || '';
    const titles = text.split('\n').map(t => t.replace(/^[-*•\d.]\s*/, '').trim()).filter(Boolean).slice(0, 3);
    
    res.json({ titles });
  } catch (err: any) {
    console.error('Fout bij genereren titels:', err);
    res.status(500).json({ error: 'Fout bij genereren titels.' });
  }
});

app.post('/api/generate-blog-content', async (req, res) => {
  try {
    if (!ai) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in .env' });
    const { title, customPrompt } = req.body;
    
    let prompt = `Je bent een ervaren, betrouwbare aankoopmakelaar ("de Woonwensmakelaar"). Schrijf een uitgebreide, professionele, en SEO-vriendelijke blogpost met de titel: "${title}".
De doelgroep is potentiële huizenkopers. De schrijfstijl is informatief, behulpzaam, en overtuigend. Gebruik de tone-of-voice van een aankoopmakelaar (focus op: besparen van geld, voorkomen van verborgen gebreken, sterk onderhandelen, volledige ontzorging).
Gebruik korte paragrafen, tussenkopjes, en een afsluitende "Call to Action" waarin je uitnodigt voor een vrijblijvend kennismakingsgesprek.
Formateer de tekst als markdown. Schrijf direct de blog, zonder inleidende tekst.`;

    if (customPrompt && customPrompt.trim()) {
      console.log(`📡 Adding custom instructions to text generation: "${customPrompt}"`);
      prompt += `\n\nLET OP: De gebruiker heeft de volgende specifieke aanwijzingen/wensen doorgegeven voor de inhoud/toon van deze tekst. Zorg dat je deze aanwijzingen strikt opvolgt en de tekst hierop aanpast: "${customPrompt}"`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    
    res.json({ content: response.text });
  } catch (err: any) {
    console.error('Fout bij genereren blog content:', err);
    res.status(500).json({ error: 'Fout bij genereren content.' });
  }
});

app.post('/api/generate-blog-image', async (req, res) => {
  try {
    if (!ai) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in .env' });
    const { title, customPrompt } = req.body;
    
    let imagePrompt = '';
    if (customPrompt && customPrompt.trim()) {
      // Optimize the user's custom prompt for Imagen 4.0
      console.log(`📡 Optimizing custom prompt: "${customPrompt}"`);
      const promptResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are an expert prompt engineer. The user wants to generate an image for a real estate blog with this description: "${customPrompt}". 
Optimize and expand this into a highly descriptive, professional prompt in English for an AI image generator (Imagen 4.0).
Ensure the result describes a high quality, realistic photo suitable for a Dutch real estate agent website. Do not include any text in the image. Return ONLY the optimized English prompt string.`,
      });
      imagePrompt = promptResponse.text || customPrompt;
    } else {
      // First generate a good prompt for the image based on the title
      console.log(`📡 Generating prompt based on title: "${title}"`);
      const promptResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are an expert prompt engineer. Write a concise, highly descriptive prompt for an AI image generator to create a professional, realistic photo for a real estate blog post titled: "${title}". 
The image should be high quality, welcoming, and suitable for a Dutch real estate agent (aankoopmakelaar) website. 
Do not include any text in the image. Return ONLY the English prompt string.`,
      });
      imagePrompt = promptResponse.text || `Professional real estate photography of a beautiful dutch house exterior, high quality, sunny day`;
    }

    console.log(`📡 Final Imagen prompt: "${imagePrompt}"`);

    const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: imagePrompt,
        config: {
            numberOfImages: 1,
            outputMimeType: 'image/jpeg',
            aspectRatio: '16:9'
        }
    });
    
    if (response.generatedImages && response.generatedImages.length > 0) {
      const base64 = response.generatedImages[0].image.imageBytes;
      res.json({ image: `data:image/jpeg;base64,${base64}` });
    } else {
      res.status(500).json({ error: 'Geen afbeelding gegenereerd.' });
    }
  } catch (err: any) {
    console.error('Fout bij genereren blog afbeelding:', err);
    res.status(500).json({ error: 'Fout bij genereren afbeelding.' });
  }
});

app.listen(port, () => {
  console.log(`🚀 WoonWens Backend draait op http://localhost:${port}`);
  console.log(`📡 Webhook Endpoint: http://localhost:${port}/webhook`);
  console.log(`📡 Match Webhook: http://localhost:${port}/webhook-match`);
  console.log(`📡 Match SSE Stream: http://localhost:${port}/api/matches/stream`);
  console.log(`📦 Data Bestand: ${DATA_FILE}`);
});
