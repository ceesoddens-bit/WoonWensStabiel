/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Home,
  Users,
  Eye,
  Gavel,
  CheckCircle2,
  XCircle,
  Clock,
  MapPin,
  MapPinOff,
  ExternalLink,
  Calendar,
  X,
  Search,
  MessageSquare,
  Copy,
  UserCheck,
  RefreshCw,
  UserPlus,
  ClipboardList,
  Trash2,
  Mail,
  Pencil,
  FileText,
  PenTool,
  Sparkles,
  Loader2,
  Image as ImageIcon,
  Check,
  LogIn,
  Printer,
  LineChart,
  Database,
  ChevronLeft,
  ChevronRight,
  Sun,
  Download,
  ArrowRight,
  CheckSquare,
  List,
  Heart
} from 'lucide-react';
import TaskList from './TaskList';
import { motion, AnimatePresence } from 'motion/react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, query, where, doc, orderBy, limit } from 'firebase/firestore';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { db, auth } from './firebase';
import Login from './Login';

type View = 'nieuwste' | 'matches' | 'manager' | 'klanten' | 'blog-post-maker' | 'database' | 'tasks' | 'stable';

// Types for our data
interface Viewing {
  address: string;
  dateTime: string;
}

interface Offer {
  amount: string;
  address: string;
  status: 'Groen' | 'Afgewezen' | 'Rood' | 'Geaccepteerd';
}

interface Customer {
  id: string;
  name: string;
  profile: {
    regio: string;
    bijzonderhedenRegio?: string;
    prijsklasse: string;
    woningtype: string;
    bijzondereKenmerken?: string;
  };
  viewings: Viewing[];
  totalViewings: number;
  offers: Offer[];
  structuralInspection?: {
    status: 'Nee' | 'Ingepland' | 'Gereed';
    date?: string;
    inspectorName?: string;
  };
  contract: {
    status: 'Nee' | 'afgewezen' | 'Ja Getekend';
    date?: string;
  };
}

interface HouseScan {
  row_number: number;
  ID: string;
  Datum: string;
  Makelaar: string;
  adres: string;
  Plaats: string;
  Wijk?: string;
  Prijs: string;
  m2: string;
  "m2 perseel": string;
  Hoevaak?: string;
  hoevaak?: string;
  status: string;
  satus?: string; // Voor compatibiliteit met oude data
  link: string;
}

interface ScanRun {
  id: string;
  title: string;
  date: Date;
  houses: HouseScan[];
}

interface Match {
  id: number;
  clientName: string;
  address: string;
  matchPercentage: number;
  reason: string;
  shortSummary: string;
  features: string[];
  link: string;
  makelaar: string;
  matchCriteria?: { label: string; client: string; house: string; match: boolean }[];
}

// N8N Webhook URL's (Rechtstreekse verbinding)
const N8N_SCANS_URL = 'https://woonwensmakelaar.app.n8n.cloud/webhook/d20bd156-86c9-40ea-86aa-f92949d207e7';
const N8N_MATCHES_URL = 'https://woonwensmakelaar.app.n8n.cloud/webhook/d20bd156-86c9-40ea-86aa-f92949d207e7match';
const N8N_PREVIOUS_SCANS_URL = 'https://woonwensmakelaar.app.n8n.cloud/webhook/8a1ca729-88f1-4635-994b-169f8f1274cb';

const getRegion = (plaats: string): string => {
  if (!plaats) return 'overige';
  const p = plaats.toLowerCase();
  
  if (p.includes('maastricht')) return 'Maastricht';
  
  const heuvelland = ['gulpen', 'wittem', 'vaals', 'eijsden', 'margraten', 'meerssen', 'valkenburg', 'bemelen', 'cadier', 'mheer', 'noorbeek', 'slenaken', 'banholt', 'reijmerstok', 'terlinden', 'eys', 'wylre', 'nijs', 'geulle', 'bunde', 'ulestraten', 'berg', 'terblijt', 'vilt', 'sibbe', 'ijzeren', 'scheulder', 'wijlre'];
  if (heuvelland.some(city => p.includes(city))) return 'heuvelland';
  
  const parkstad = ['heerlen', 'kerkrade', 'landgraaf', 'brunssum', 'simpelveld', 'voerendaal', 'nuth', 'schinnen', 'onderbanken', 'beekdaelen', 'hulsberg', 'schimmert', 'wynandsrade', 'hoensbroek', 'eygelshoven', 'nieuwenhagen', 'uubachsberg', 'bocholtz'];
  if (parkstad.some(city => p.includes(city))) return 'parkstad';
  
  const westelijkeMijnstreek = ['sittard', 'geleen', 'beek', 'stein', 'elsloo', 'spaubeek', 'born', 'munstergeleen', 'puth', 'sweikhuizen', 'urmond', 'berg aan de maas', 'neerbeek', 'genhout', 'groot genhout'];
  if (westelijkeMijnstreek.some(city => p.includes(city))) return 'westelijke mijnstreek';
  
  const echtRoermond = ['echt', 'susteren', 'roermond', 'roerdalen', 'maasgouw', 'leudal', 'itternoorbeek', 'wessem', 'heel', 'thorn', 'linne', 'herten', 'swalmen', 'montfort', 'sint odilienberg', 'vlodrop', 'herkenbosch', 'posterholt', 'melick', 'vlodrop', 'sint joost', 'koningsbosch', 'mariahop', 'peij', 'nieuwstadt'];
  if (echtRoermond.some(city => p.includes(city))) return 'Echt Roermond';
  
  return 'overige';
};


// --- Direct N8N Parsing Helpers ---

// Helper voor PDOK Wijk Lookup (nu in de frontend)
async function getOfficialWijk(adres: string, plaats: string): Promise<string> {
  try {
    const rawQuery = `${adres}, ${plaats}`;
    const suggestUrl = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/suggest?q=${encodeURIComponent(rawQuery)}&rows=1`;
    const suggestRes = await fetch(suggestUrl);
    const suggestData: any = await suggestRes.json();

    if (suggestData?.response?.docs?.length > 0) {
      const doc = suggestData.response.docs[0];
      const lookupUrl = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/lookup?id=${doc.id}`;
      const lookupRes = await fetch(lookupUrl);
      const lookupData: any = await lookupRes.json();
      
      if (lookupData?.response?.docs?.length > 0) {
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

function parseStructuredN8nMatches(sourceArray: any[], datum: string): any[] {
  return sourceArray.map((item: any, index: number) => {
    let percentage = 0;
    const rawPct = item["match %"];
    if (typeof rawPct === 'number') {
      percentage = rawPct <= 1 && rawPct > 0 ? Math.round(rawPct * 100) : Math.round(rawPct);
    } else {
      const pctStr = String(rawPct || "0%");
      let parsed = parseInt(pctStr.replace(/\D/g, '')) || 0;
      if (pctStr.includes('.') && parsed < 10) parsed *= 10;
      percentage = parsed <= 1 && parsed > 0 ? Math.round(parsed * 100) : Math.round(parsed);
      if (percentage > 100) percentage = Math.floor(percentage / 10);
    }
    
    let isRegionMatch = (item["afstand zoekgebied"] || '').toLowerCase().trim() === "ja" || (item["afstand zoekgebied"] || '').toLowerCase().includes("exact") || (item["afstand zoekgebied"] || '').toLowerCase().includes("binnen");
    let isBudgetMatch = (item["prijs binnen budget"] || '').toLowerCase().includes("ja");
    let isSpecialMatch = true;

    // --- Verbeterde Woningtype & Woningsoort Check ---
    const checkSpecificMatch = (clientVal: string, houseVal: string) => {
      const c = (clientVal || '').toLowerCase().trim();
      const h = (houseVal || '').toLowerCase().trim();
      
      if (!c || c === 'alle woningtypes' || c.includes('n.v.t.') || c === 'nvt' || c === 'geen') return true;
      if (!h || h === 'n.v.t.' || h === 'nvt') return false;

      const clientWords = c.split(/[, \/]+/).filter((w: string) => w.length > 3);
      const synonyms: Record<string, string[]> = {
        'tweekapper': ['twee-onder-een', '2-onder-1', 'halfvrijstaand', 'geschakeld'],
        'halfvrijstaand': ['2-onder-1', 'tweekapper', 'twee-onder-een', 'geschakeld'],
        'bungalow': ['levensloopbestendig', 'gelijkvloers'],
        'levensloopbestendig': ['bungalow', 'gelijkvloers', 'semi-bungalow'],
        'vrijstaand': ['vrijstaande'],
        'eengezinswoning': ['tussenwoning', 'hoekwoning', 'rijtjeshuis']
      };

      for (const cw of clientWords) {
        if (h.includes(cw)) return true;
        if (synonyms[cw]) {
          for (const syn of synonyms[cw]) {
            if (h.includes(syn)) return true;
          }
        }
      }
      return false;
    };

    const clientType = item["woning type klnt prof"];
    const houseType = item["woning type adres"] || item["woning type"]; // fallback naar oude naam
    const clientSoort = item["woning soort klnt prof"];
    const houseSoort = item["woning soort adres"];

    let isTypeMatch = checkSpecificMatch(clientType, houseType);
    let isSoortMatch = checkSpecificMatch(clientSoort, houseSoort);


    // Use match_percentage_opbouw if provided by N8N
    const opbouw = item["match_percentage_opbouw"];
    const checkOpbouw = (val: any, fallback: boolean) => {
      if (val === undefined || val === null) return fallback;
      if (typeof val === 'boolean') return val;
      if (typeof val === 'number') return val > 0;
      if (typeof val === 'string') return val.includes('25') || val.toLowerCase().includes('true') || val.toLowerCase().includes('ja');
      return fallback;
    };

    if (opbouw && typeof opbouw === 'object') {
      isRegionMatch = checkOpbouw(opbouw.locatie, isRegionMatch);
      isBudgetMatch = checkOpbouw(opbouw.prijs, isBudgetMatch);
      const groupTypeMatch = checkOpbouw(opbouw["woning type"] || opbouw.woningtype || opbouw.woning_type, isTypeMatch && isSoortMatch);
      // Als de opbouw zegt dat het een match is, forceren we beide naar true als ze individueel ook ok lijken, 
      // of we volgen de opbouw strikt voor beide.
      isTypeMatch = groupTypeMatch;
      isSoortMatch = groupTypeMatch;
      isSpecialMatch = checkOpbouw(opbouw.bijzonderheden, isSpecialMatch);
    } else if (typeof opbouw === 'string') {
       try {
         const parsedOpbouw = JSON.parse(opbouw);
         isRegionMatch = checkOpbouw(parsedOpbouw.locatie, isRegionMatch);
         isBudgetMatch = checkOpbouw(parsedOpbouw.prijs, isBudgetMatch);
         const groupTypeMatch = checkOpbouw(parsedOpbouw["woning type"] || parsedOpbouw.woningtype || parsedOpbouw.woning_type, isTypeMatch && isSoortMatch);
         isTypeMatch = groupTypeMatch;
         isSoortMatch = groupTypeMatch;
         isSpecialMatch = checkOpbouw(parsedOpbouw.bijzonderheden, isSpecialMatch);
       } catch (e) {
          // If it is a comma-separated string like "locatie: 25%, prijs: 0%, woning type: 0%, bijzonderheden: 25%"
          const lowerStr = opbouw.toLowerCase();
          const extractPct = (keywords: string[]) => {
            for (const kw of keywords) {
               const idx = lowerStr.indexOf(kw);
               if (idx !== -1) {
                  const snippet = lowerStr.substring(idx, idx + 40); // larger lookahead for text in parentheses
                  const match = snippet.match(/:\s*(\d+)%/);
                  if (match) {
                     return parseInt(match[1], 10) > 0;
                  }
               }
            }
            return null;
          };

          const rRegion = extractPct(['locatie', 'regio', 'afstand']);
          if (rRegion !== null) isRegionMatch = rRegion;

          const rBudget = extractPct(['prijs', 'budget']);
          if (rBudget !== null) isBudgetMatch = rBudget;

          const rType = extractPct(['woning type', 'woningtype', 'type']);
          if (rType !== null) {
            isTypeMatch = rType;
            isSoortMatch = rType;
          }

          const rSpecial = extractPct(['bijzonderheden', 'kenmerken', 'eisen']);
          if (rSpecial !== null) isSpecialMatch = rSpecial;
       }
    }

    const noBijzonderheden = (item["bijzondere kenmerken klnt prof"] || '').toLowerCase().trim();
    if (noBijzonderheden === 'geen' || noBijzonderheden === 'n.v.t.' || noBijzonderheden === 'nvt') {
       isSpecialMatch = true;
    }

    // STRICT SANITY CHECK: Ensure the number of green checks mathematically matches the percentage.
    // e.g., 75% means exactly 3 greens. 50% means exactly 2 greens.
    // We only run this fallback if N8N did NOT provide the opbouw string.
    if (!opbouw) {
       const expectedGreens = Math.round((percentage / 100) * 5);
       const checks = [
         // We order them by "most likely to be the subjective mismatch" first, so if we HAVE to guess, we guess smart.
         { name: 'special', get: () => isSpecialMatch, set: (v: boolean) => isSpecialMatch = v },
         { name: 'soort', get: () => isSoortMatch, set: (v: boolean) => isSoortMatch = v },
         { name: 'type', get: () => isTypeMatch, set: (v: boolean) => isTypeMatch = v },
         { name: 'region', get: () => isRegionMatch, set: (v: boolean) => isRegionMatch = v },
         { name: 'budget', get: () => isBudgetMatch, set: (v: boolean) => isBudgetMatch = v }
       ];


       let currentGreens = checks.filter(c => c.get()).length;

       // If we have TOO MANY greens for the percentage (e.g. 4 greens on 75%), force the most subjective ones to red.
       while (currentGreens > expectedGreens) {
         const activeCheck = checks.find(c => c.get());
         if (activeCheck) {
            // Only set to false if it's not the forced 'geen' bijzonderheden
            if (activeCheck.name === 'special' && (noBijzonderheden === 'geen' || noBijzonderheden === 'n.v.t.' || noBijzonderheden === 'nvt')) {
               // Skip forcing this to red. Find the next one.
               const nextCheck = checks.find(c => c.get() && c.name !== 'special');
               if (nextCheck) {
                  nextCheck.set(false);
                  currentGreens--;
               } else break;
            } else {
               activeCheck.set(false);
               currentGreens--;
            }
         } else {
            break;
         }
       }

       // If we have TOO FEW greens (e.g. 2 greens on 75%), force some to green.
       while (currentGreens < expectedGreens) {
         const inactiveCheck = [...checks].reverse().find(c => !c.get());
         if (inactiveCheck) {
            inactiveCheck.set(true);
            currentGreens++;
         } else {
            break;
         }
       }
    }

    return {
      id: `n8n-${Date.now()}-${index}`,
      clientName: item["naam klant"] || "Onbekende Klant",
      address: item["adres"] || "Onbekend Adres",
      matchPercentage: percentage,
      reason: item["analyse"] || "Geen analyse beschikbaar.",
      link: item["link woning"] || "#",
      makelaar: "Zie link",
      shortSummary: `Vraagprijs: ${item["prijs"] || 'Onbekend'}`,
      features: [],
      matchCriteria: [
        { label: "📍 Regio", client: item["zk geb. klant"] || "Volgens profiel", house: `${item["afstand zoekgebied"] || 'ja'}`, match: isRegionMatch },
        { label: "💰 Budget", client: item["budget range"] || "Volgens profiel", house: `${item["prijs"] || 'n.v.t.'} · ${item["prijs binnen budget"] || ''}`, match: isBudgetMatch },
        { label: "🏠 Woningtype", client: item["woning type klnt prof"] || "n.v.t.", house: item["woning type adres"] || item["woning type"] || "n.v.t.", match: isTypeMatch },
        { label: "🏘️ Woningsoort", client: item["woning soort klnt prof"] || "n.v.t.", house: item["woning soort adres"] || "n.v.t.", match: isSoortMatch },
        { label: "✨ Bijzonderheden", client: item["bijzondere kenmerken klnt prof"] || "Volgens profiel", house: item["bijzondere kenmerken"] || "n.v.t.", match: isSpecialMatch }
      ],

      datum: item["datum"] || item["Datum"] || item["timestamp"] || item["created_at"] || datum
    };
  });
}

const parseN8nScans = async (houses: any[]) => {
  const processed: any[] = [];
  console.log(`📦 Verwerken van ${houses.length} ruwe scans...`);
  
  const chunkSize = 20;
  for (let i = 0; i < houses.length; i += chunkSize) {
    const chunk = houses.slice(i, i + chunkSize);
    
    const chunkProcessed = await Promise.all(chunk.map(async (house) => {
      // Normaliseer keys (sommige webhooks gebruiken 'address', 'Adres', etc.)
      Object.keys(house).forEach(k => {
        const lowerK = k.toLowerCase();
        // Adres
        if ((lowerK === 'address' || lowerK === 'adres') && !house.adres) house.adres = house[k];
        // Plaats
        if (lowerK === 'plaats' && !house.Plaats) house.Plaats = house[k];
        // Wijk
        if (lowerK === 'wijk' && !house.Wijk) house.Wijk = house[k];
        // Status
        if (lowerK === 'status' || lowerK === 'satus') house.status = house[k];
        // Datum
        if (lowerK === 'datum') house.Datum = house[k];
        // Link
        if (lowerK === 'link') house.link = house[k];
        // m2
        if (lowerK === 'm2' || lowerK === 'oppervlakte') house.m2 = house[k];
        if (lowerK === 'm2 perseel' || lowerK === 'm2 perceel' || lowerK === 'perceel') house["m2 perseel"] = house[k];
        // Makelaar / Prijs are handled below but we can do them here too
        if (lowerK.includes('prijs')) house.Prijs = house[k];
        if (lowerK.includes('makelaar') || lowerK.includes('verkoper')) house.Makelaar = house[k];
      });

      if (!house.adres || !house.Plaats) {
        console.warn('⚠️ Scan overgeslagen: mist adres of plaats', house);
        return null;
      }
      
      // Optioneel: wijk opzoeken als deze ontbreekt
      if (!house.Wijk || house.Wijk === 'Onbekend') {
        house.Wijk = await getOfficialWijk(house.adres, house.Plaats);
        
        // Sla de gevonden wijk op in Firestore zodat dit adres niet telkens opnieuw gezocht hoeft te worden
        if (house.id && house.Wijk && house.Wijk !== 'Onbekend') {
          try {
            // De woningen in het 'Nieuwste' overzicht komen uit NieuweHuizenPerScrape
            await updateDoc(doc(db, 'NieuweHuizenPerScrape', house.id), { Wijk: house.Wijk });
            console.log(`💾 Wijk '${house.Wijk}' opgeslagen in Firestore voor ${house.adres}`);
          } catch (err) {
            console.error(`⚠️ Fout bij opslaan wijk voor ${house.adres}:`, err);
          }
        }
      }
      
      house.status = house.status || house.satus || 'Beschikbaar';
      house.m2 = (house.m2 || '--').toString().replace(/&#178;/g, '²');
      house["m2 perseel"] = (house["m2 perseel"] || '--').toString().replace(/&#178;/g, '²');

      if (typeof house.Prijs === 'number') {
        house.Prijs = '€ ' + house.Prijs.toLocaleString('nl-NL');
      } else if (typeof house.Prijs === 'string' && !house.Prijs.includes('€') && !isNaN(Number(house.Prijs))) {
        house.Prijs = '€ ' + Number(house.Prijs).toLocaleString('nl-NL');
      } else if (typeof house.Prijs === 'string' && !house.Prijs.includes('€')) {
        house.Prijs = '€ ' + house.Prijs;
      }
      
      house.Prijs = house.Prijs || 'Prijs op aanvraag';
      house.Makelaar = house.Makelaar || 'Onbekende Makelaar';
      if (house.Makelaar === 'Zie link') house.Makelaar = 'Onbekende Makelaar';
      if (!house.Datum) house.Datum = new Date().toLocaleDateString('nl-NL');
      
      return house;
    }));
    
    // Voeg de succesvol verwerkte huizen toe
    for (const h of chunkProcessed) {
      if (h) processed.push(h);
    }
  }
  
  return processed;
};

// --- Einde N8N Helpers ---

const parsePrice = (priceVal: any): number => {
  if (priceVal === undefined || priceVal === null) return 0;
  if (typeof priceVal === 'number') return priceVal;
  const str = String(priceVal);
  const numStr = str.replace(/[^0-9]/g, '');
  return parseInt(numStr, 10) || 0;
};

const parseScanDate = (dateStr: any): Date | null => {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  
  // Pattern 1: ISO Date (YYYY-MM-DD...)
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return new Date(str.substring(0, 10));
  }
  
  // Pattern 2: DD-MM-YYYY ...
  const dmyMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    return new Date(year, month, day);
  }

  // Pattern 3: DD-MM-YY ...
  const dmyShortMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{2})(?!\d)/);
  if (dmyShortMatch) {
    const day = parseInt(dmyShortMatch[1], 10);
    const month = parseInt(dmyShortMatch[2], 10) - 1;
    const year = 2000 + parseInt(dmyShortMatch[3], 10);
    return new Date(year, month, day);
  }

  // Pattern 4: DD-MM ...
  const dmMatch = str.match(/^(\d{1,2})-(\d{1,2})/);
  if (dmMatch) {
    const day = parseInt(dmMatch[1], 10);
    const month = parseInt(dmMatch[2], 10) - 1;
    const year = 2026;
    return new Date(year, month, day);
  }
  
  return null;
};

const MatchIcon = ({ size = 24, strokeWidth = 1.5, className = "" }: any) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    width={size}
    height={size}
  >
    {/* Left overlapping circle */}
    <circle cx="8" cy="12" r="6" />
    {/* Right overlapping circle */}
    <circle cx="16" cy="12" r="6" />
    {/* Middle spark/star */}
    <path d="M12 9s0 3 3 3-3 3-3 3 0-3-3-3 3-3 3-3z" fill="currentColor" />
  </svg>
);

const HouseScanCard: React.FC<{ scan: HouseScan, matches: any[] }> = ({ scan, matches }) => {
  const relevantMatches = matches.filter(m => 
    m.address && m.address.includes(scan.adres) && m.matchPercentage >= 50
  );

  const mapQuery = `${scan.adres}, ${scan.Plaats}`;
  const mapUrl = `https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&t=&z=14&ie=UTF8&iwloc=&output=embed`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card shadow-2xl border-none overflow-hidden hover:shadow-[#141e2b]/10 transition-all duration-500"
    >
      <div className="flex flex-col lg:flex-row">
        {/* Left Side: Info */}
        <div className="flex-1 p-5 sm:p-8 flex flex-col gap-5 sm:gap-6 min-w-0">
          {/* Header with Address and Price */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start gap-2">
              <h3 className="text-xl sm:text-2xl font-bold text-[#2d3e50] leading-tight">{scan.adres}</h3>
              <span className={`px-3 py-1 rounded-full text-[10px] uppercase tracking-wider font-black shadow-sm flex-shrink-0 ${
                  (scan.status || scan.satus) === 'Nieuw in verkoop' ? 'bg-red-500 text-white' :
                  (scan.status || scan.satus) === 'Onder bod' ? 'bg-amber-500 text-white' :
                  'bg-blue-600 text-white'
                }`}>
                {(scan.status || scan.satus || '--') === '--' ? 'Beschikbaar' : (scan.status || scan.satus)}
              </span>
            </div>
            <div className="flex flex-row justify-between items-end gap-2">
              <p className="text-slate-500 font-medium">
                {scan.Plaats}{scan.Wijk ? ` • ${scan.Wijk}` : ''}
              </p>
              <div className="text-right flex-shrink-0">
                <p className="text-2xl sm:text-3xl font-black text-blue-600">{scan.Prijs}</p>
                <p className="text-xs text-slate-400 font-medium uppercase tracking-widest">Scan: {scan.Datum}</p>
              </div>
            </div>
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 py-5 sm:py-6 border-y border-slate-100">
            <div className="flex items-center gap-4 text-slate-600">
              <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-xl shadow-sm border border-slate-100">🏢</div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold leading-none mb-1.5">Makelaar</p>
                <p className="text-sm font-bold text-[#2d3e50]">{scan.Makelaar || 'N/A'}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-slate-600">
              <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-xl shadow-sm border border-slate-100">📏</div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold leading-none mb-1.5">Oppervlakte</p>
                <p className="text-sm font-bold text-[#2d3e50]">
                  {scan.m2 && scan.m2 !== '--' ? scan.m2 : 'N/A'}
                  {scan.m2 && scan.m2 !== '--' && scan.m2.replace ? (
                    parseInt(scan.m2.replace(/[^0-9]/g, '')) > 350 && (
                      <span className="text-amber-600 ml-1 text-[10px] font-medium">(waarschijnlijk perceel)</span>
                    )
                  ) : null}
                  {scan["m2 perseel"] && scan["m2 perseel"] !== '--' ? ` (Perceel: ${scan["m2 perseel"]})` : ''}
                </p>
              </div>
            </div>
          </div>

          {/* Match Notes */}
          {relevantMatches.length > 0 && (
            <div className="flex flex-col gap-2">
              {relevantMatches.map(match => (
                <div key={match.id} className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-start gap-4">
                  <div className="mt-1 text-emerald-500">
                    <MatchIcon size={20} strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-emerald-800">
                      Top Match met {match.clientName} ({match.matchPercentage}%)
                    </p>
                    <p className="text-xs text-emerald-600 mt-0.5 line-clamp-1">{match.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Link Section */}
          <div className="mt-auto pt-4 flex flex-col sm:flex-row gap-3 min-w-0">
            <button 
              onClick={() => window.open(scan.link, '_blank')}
              className="flex-1 py-4 bg-[#141e2b] text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-slate-800 transition-all shadow-lg group"
            >
              <span>Woning bekijken</span>
              <ExternalLink size={20} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
            </button>
            <div className="hidden sm:flex items-center px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl min-w-0 flex-1 text-center overflow-hidden">
               <p className="text-xs text-slate-400 font-medium truncate">{scan.link}</p>
            </div>
          </div>
        </div>

        {/* Right Side: Map */}
        <div className="w-full lg:w-[450px] h-[280px] sm:h-[360px] lg:h-auto relative bg-slate-50 border-t lg:border-t-0 lg:border-l border-slate-100 group">
          <div className="absolute inset-0 grayscale-[0.2] contrast-[1.1] transition-all duration-700 group-hover:grayscale-0">
            <iframe 
              width="100%" 
              height="100%" 
              style={{ border: 0 }}
              loading="lazy"
              allowFullScreen
              title={`Map for ${scan.adres}`}
              src={mapUrl}
            />
          </div>
          {/* Subtle overlay to make it fit with the design */}
          <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-black/5" />
        </div>
      </div>
    </motion.div>
  );
};

const MatchCard: React.FC<{ match: Match, klanten?: any[], scans?: any[], onAddInteressanteWoning?: (klantId: string, address: string) => void }> = ({ match, klanten = [], scans = [], onAddInteressanteWoning }) => {
  let klant = klanten.find((k: any) => k.Naam && match.clientName && (k.Naam.includes(match.clientName) || match.clientName.includes(k.Naam.split(' ')[0])));
  if (!klant && klanten.length > 0) klant = klanten[0]; // Fallback voor huidige testdata (bijv. "Renaldo1")

  const matchHouse = scans.find((h: any) => match.address.startsWith(h.adres) || match.address.includes(h.adres) || (h.Plaats && match.address.includes(h.Plaats)));

  const [messageModal, setMessageModal] = useState<{ title: string; message: string; type: 'makelaar' | 'klant' } | null>(null);
  const [editedMessage, setEditedMessage] = useState('');
  const [copied, setCopied] = useState(false);

  const [showPlannenModal, setShowPlannenModal] = useState(false);
  const [plannenStatus, setPlannenStatus] = useState<'idle' | 'saving' | 'success'>('idle');
  const [plannenTaskText, setPlannenTaskText] = useState('Bezichtiging plannen');
  const [plannenDate, setPlannenDate] = useState(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
  const [plannenTime, setPlannenTime] = useState('12:00');

  const handlePlannenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPlannenStatus('saving');
    try {
      const taskPayload = {
        text: plannenTaskText,
        done: false,
        type: 'taak',
        dueDate: plannenDate,
        dueTime: plannenTime,
        klant: klant?.Naam || match.clientName || '',
        woning: match.address,
        createdAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'tasks'), taskPayload);
      setPlannenStatus('success');
    } catch (err) {
      console.error('Error adding task:', err);
      alert('Er is een fout opgetreden bij het opslaan van de taak. Probeer het opnieuw.');
      setPlannenStatus('idle');
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    if (score >= 50) return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  const getProgressColor = (score: number) => {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 50) return 'bg-amber-500';
    return 'bg-red-500';
  };

  const openMakelaarMessage = () => {
    const today = new Date();
    const dateStr = today.toLocaleDateString('nl-NL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const realMakelaar = matchHouse?.Makelaar || matchHouse?.makelaar || match.makelaar;
    const cleanMakelaar = realMakelaar === 'Zie link' ? 'Makelaar' : realMakelaar;
    
    const message = `Beste ${cleanMakelaar},\n\nIk zou graag een bezichtiging willen inplannen voor de ${match.address} op ${dateStr}. Laat me weten of dat mogelijk is.\n\nVriendelijke groet,\nRenaldo`;
    setMessageModal({ title: `Bericht voor ${cleanMakelaar}`, message, type: 'makelaar' });
    setEditedMessage(message);
    setCopied(false);
  };

  const openKlantMessage = () => {
    const houseLink = match.link || matchHouse?.link;

    // Unieke match-punten als komma-opsomming (zonder woningsoort)
    const seen = new Set<string>();
    const points: string[] = [];
    if (match.matchCriteria) {
      match.matchCriteria.forEach(c => {
        if (c.match) {
          let label = '';
          if (c.label.includes('Budget')) label = 'valt binnen jullie budget';
          else if (c.label.includes('Regio')) label = 'ligt in jullie zoekgebied';
          else if (c.label.includes('Woningtype')) label = 'juiste woningtype';
          else if (c.label.includes('Bijzonderheden')) label = 'voldoet aan jullie bijzondere eisen';
          if (label && !seen.has(label)) {
            seen.add(label);
            points.push(label);
          }
        }
      });
    }

    const formatList = (items: string[]) => {
      if (items.length === 0) return '';
      if (items.length === 1) return items[0];
      return items.slice(0, -1).join(', ') + ' en ' + items[items.length - 1];
    };
    const summary = points.length > 0 ? `\n\nDeze woning ${formatList(points)}.` : '';
    const message = `${houseLink || ''}${summary}`;
    setMessageModal({ title: `Bericht voor ${match.clientName}`, message, type: 'klant' });
    setEditedMessage(message);
    setCopied(false);
  };

  const handleAddInteressant = () => {
    if (klant && onAddInteressanteWoning) {
      onAddInteressanteWoning(klant.id, match.address);
      alert('Woning toegevoegd aan interessante woningen van deze klant!');
    } else if (!klant) {
      alert('Geen klantprofiel gevonden voor deze match. Controleer de naam.');
    }
  };

  const copyMessage = () => {
    navigator.clipboard.writeText(editedMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <>
      {/* Message Modal */}
      <AnimatePresence>
        {messageModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMessageModal(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-200"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${messageModal.type === 'makelaar'
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-orange-100 text-[#e67e22]'
                    }`}>
                    {messageModal.type === 'makelaar' ? <MessageSquare size={20} /> : <UserCheck size={20} />}
                  </div>
                  <h3 className="text-lg font-bold text-[#2d3e50]">{messageModal.title}</h3>
                </div>
                <button
                  onClick={() => setMessageModal(null)}
                  className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6">
                <textarea
                  value={editedMessage}
                  onChange={(e) => { setEditedMessage(e.target.value); setCopied(false); }}
                  className="w-full bg-slate-50 rounded-2xl p-5 border border-slate-200 text-[#2d3e50] leading-relaxed text-[15px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all"
                  rows={8}
                />
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                <button
                  onClick={() => setMessageModal(null)}
                  className="px-5 py-2.5 border-2 border-slate-300 text-slate-600 rounded-xl font-bold hover:bg-white transition-colors"
                >
                  Sluiten
                </button>
                <button
                  onClick={copyMessage}
                  className={`px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all ${copied
                      ? 'bg-emerald-500 text-white'
                      : 'bg-[#141e2b] text-white hover:bg-slate-800'
                    }`}
                >
                  {copied ? (
                    <>
                      <CheckCircle2 size={18} />
                      <span>Gekopieerd!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={18} />
                      <span>Kopieer bericht</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bezichtiging Plannen Modal */}
      <AnimatePresence>
        {showPlannenModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { if (plannenStatus !== 'saving') setShowPlannenModal(false); }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-200"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-100 text-blue-600">
                    <Calendar size={20} />
                  </div>
                  <h3 className="text-lg font-bold text-[#2d3e50]">Bezichtiging plannen</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPlannenModal(false)}
                  disabled={plannenStatus === 'saving'}
                  className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500 disabled:opacity-50"
                >
                  <X size={20} />
                </button>
              </div>

              {plannenStatus === 'success' ? (
                <div className="p-8 text-center flex flex-col items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <CheckCircle2 size={36} />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-[#2d3e50]">Taak toegevoegd!</h4>
                    <p className="text-sm text-slate-500 mt-1">
                      De taak is succesvol toegevoegd aan de takenlijst.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPlannenModal(false);
                      setPlannenStatus('idle');
                    }}
                    className="mt-4 px-6 py-2.5 bg-[#141e2b] text-white rounded-xl font-bold hover:bg-slate-800 transition-colors"
                  >
                    Sluiten
                  </button>
                </div>
              ) : (
                <form onSubmit={handlePlannenSubmit} className="p-6 space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Taak</label>
                    <input
                      type="text"
                      required
                      value={plannenTaskText}
                      onChange={(e) => setPlannenTaskText(e.target.value)}
                      className="w-full bg-slate-50 rounded-xl px-4 py-2.5 border border-slate-200 text-[#2d3e50] text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Klant</label>
                      <input
                        type="text"
                        disabled
                        value={klant?.Naam || match.clientName || ''}
                        className="w-full bg-slate-100 rounded-xl px-4 py-2.5 border border-slate-200 text-slate-500 text-sm cursor-not-allowed"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Woning</label>
                      <input
                        type="text"
                        disabled
                        value={match.address}
                        className="w-full bg-slate-100 rounded-xl px-4 py-2.5 border border-slate-200 text-slate-500 text-sm truncate cursor-not-allowed"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Datum (Vandaag)</label>
                      <input
                        type="date"
                        required
                        value={plannenDate}
                        onChange={(e) => setPlannenDate(e.target.value)}
                        className="w-full bg-slate-50 rounded-xl px-4 py-2.5 border border-slate-200 text-[#2d3e50] text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tijdstip</label>
                      <input
                        type="time"
                        required
                        value={plannenTime}
                        onChange={(e) => setPlannenTime(e.target.value)}
                        className="w-full bg-slate-50 rounded-xl px-4 py-2.5 border border-slate-200 text-[#2d3e50] text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all"
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
                    <button
                      type="button"
                      disabled={plannenStatus === 'saving'}
                      onClick={() => setShowPlannenModal(false)}
                      className="px-5 py-2.5 border-2 border-slate-300 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                      Annuleren
                    </button>
                    <button
                      type="submit"
                      disabled={plannenStatus === 'saving'}
                      className="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-md hover:shadow-lg flex items-center gap-2 disabled:opacity-50"
                    >
                      {plannenStatus === 'saving' ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Opslaan...
                        </>
                      ) : (
                        'Taak toevoegen'
                      )}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="glass-card overflow-hidden border border-slate-300 p-6 hover:shadow-xl transition-all group"
      >
        <div className="flex flex-col gap-6">
          {/* Header: Client & Score */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start gap-2">
              <h3 className="text-xl sm:text-2xl font-bold text-[#2d3e50]">{match.clientName}</h3>
              <div className={`px-4 py-1 rounded-full text-sm font-black border flex-shrink-0 ${getScoreColor(match.matchPercentage)}`}>
                {match.matchPercentage}% Match
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2 text-slate-500 font-medium">
                <MapPin size={16} className="flex-shrink-0" />
                <span className="text-sm">{match.address}</span>
              </div>
              <div className="w-full sm:w-48 flex-shrink-0">
                <div className="flex justify-between text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">
                  <span>Match Score</span>
                  <span>{match.matchPercentage}%</span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${match.matchPercentage}%` }}
                    transition={{ duration: 1, delay: 0.2 }}
                    className={`h-full ${getProgressColor(match.matchPercentage)}`}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Match Criteria Comparison */}
          {match.matchCriteria && match.matchCriteria.length > 0 && (
            <div className="bg-white/50 rounded-2xl border border-slate-100 overflow-hidden">
              <div className="px-5 pt-4 pb-2">
                <h4 className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-black">Match Vergelijking</h4>
              </div>
              <div className="divide-y divide-slate-100">
                {/* Desktop header – hidden on mobile */}
                <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr] px-5 py-2 bg-slate-50">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Criterium</span>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Klant wil</span>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Woning biedt</span>
                </div>
                {match.matchCriteria.map((c, i) => {
                  // Slim: overschrijf de match-boolean op basis van tekst-inhoud
                  let effectiveMatch = c.match;

                  // "dichtbij zoekgebied" in de woning-tekst = GEEN exacte match → rood
                  const houseLower = (c.house || '').toLowerCase();
                  if (houseLower.includes('dichtbij zoekgebied') || houseLower.includes('dicht bij zoekgebied') || houseLower.includes('nabij zoekgebied') || houseLower.includes('buiten zoekgebied')) {
                    effectiveMatch = false;
                  }

                  // Slaapkamers: klant wil minimaal X, woning heeft maar Y → rood
                  const clientLower = (c.client || '').toLowerCase();
                  const minBedMatch = clientLower.match(/minimaal\s+(\d+)\s*slaapkamer/);
                  if (minBedMatch) {
                    const wanted = parseInt(minBedMatch[1]);
                    const houseNumMatch = houseLower.match(/(\d+)\s*slaapkamer/);
                    if (houseNumMatch) {
                      const has = parseInt(houseNumMatch[1]);
                      if (has < wanted) effectiveMatch = false;
                    }
                  }

                  let isEssentieel = false;
                  if (klant) {
                    const prios = Array.isArray(klant.Prioriteiten) ? klant.Prioriteiten : (typeof klant.Prioriteiten === 'string' ? klant.Prioriteiten.split(',').map((p: string) => p.trim()) : []);
                    const labelL = c.label.toLowerCase();
                    if (labelL.includes('regio') && prios.includes('locatie')) isEssentieel = true;
                    if (labelL.includes('budget') && prios.includes('prijs')) isEssentieel = true;
                    if (labelL.includes('woningtype') && prios.includes('bouwvorm')) isEssentieel = true;
                    if (labelL.includes('woningsoort') && prios.includes('objectsoort')) isEssentieel = true;
                    if (labelL.includes('bijzonderheden') && klant.BijzondereKenmerken && klant.BijzondereKenmerken.trim() !== '') isEssentieel = true;
                  }

                  const essentieelBorderMobile = isEssentieel ? 'border-2 border-amber-400 bg-amber-50/80 rounded-lg my-1 shadow-sm' : (effectiveMatch ? '' : 'bg-red-50/50');
                  const essentieelBorderDesktop = isEssentieel ? 'border-2 border-amber-400 bg-amber-50/80 rounded-lg shadow-sm mx-2 my-1' : (effectiveMatch ? 'hover:bg-slate-50/50' : 'bg-red-50/50');

                  return (
                    <div key={i}>
                      {/* Mobile: card layout */}
                      <div className={`sm:hidden px-4 py-3 transition-colors ${essentieelBorderMobile}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={`text-sm font-bold flex items-center gap-1.5 ${effectiveMatch ? 'text-slate-600' : 'text-red-700'} ${isEssentieel ? 'text-amber-700' : ''}`}>
                            {c.label} {isEssentieel && <span className="text-amber-500" title="Essentiële eis">⭐</span>}
                          </span>
                          {effectiveMatch ? (
                            <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                              <CheckCircle2 size={12} />
                            </div>
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                              <XCircle size={12} />
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-slate-400 font-bold uppercase tracking-wide text-[9px] mb-0.5">Klant wil</p>
                            <p className={`font-medium ${effectiveMatch ? 'text-slate-700' : 'text-red-800'}`}>{c.client}</p>
                          </div>
                          <div>
                            <p className="text-slate-400 font-bold uppercase tracking-wide text-[9px] mb-0.5">Woning biedt</p>
                            <p className={`font-bold ${effectiveMatch ? 'text-emerald-700' : 'text-red-700'}`}>{c.house}</p>
                          </div>
                        </div>
                      </div>
                      {/* Desktop: 3-column row */}
                      <div className={`hidden sm:grid grid-cols-[1fr_1fr_1fr] items-center px-5 py-3 transition-colors ${essentieelBorderDesktop}`}>
                        <span className={`text-sm font-semibold flex items-center gap-1.5 ${effectiveMatch ? 'text-slate-600' : 'text-red-700'} ${isEssentieel ? 'text-amber-700' : ''}`}>
                          {c.label} {isEssentieel && <span className="text-amber-500" title="Essentiële eis">⭐</span>}
                        </span>
                        <span className={`text-sm font-medium ${effectiveMatch ? 'text-slate-700' : 'text-red-800'}`}>{c.client}</span>
                        <div className="flex items-center gap-2">
                          {effectiveMatch ? (
                            <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 text-emerald-600">
                              <CheckCircle2 size={12} />
                            </div>
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 text-red-600">
                               <XCircle size={12} />
                            </div>
                          )}
                          <span className={`text-sm font-bold ${effectiveMatch ? 'text-emerald-700' : 'text-red-700'}`}>{c.house}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Right Side / Map (Minimal) */}
          <div className="pt-4 mt-2">
            <h4 className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-black mb-3">Woning Locatie</h4>
            <div className="w-full h-[200px] sm:h-[250px] relative bg-slate-50 border border-slate-100 rounded-2xl overflow-hidden group">
              <div className="absolute inset-0 grayscale-[0.2] contrast-[1.1] transition-all duration-700 group-hover:grayscale-0">
                <iframe 
                  width="100%" 
                  height="100%" 
                  style={{ border: 0 }}
                  loading="lazy"
                  allowFullScreen
                  title={`Map for ${match.address}`}
                  src={`https://www.google.com/maps?q=${encodeURIComponent(match.address)}&output=embed`}
                />
              </div>
              <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-black/5" />
            </div>
          </div>
          <div className="pt-2 grid grid-cols-2 lg:grid-cols-5 gap-3">
            <button
              onClick={() => window.open(match.link, '_blank')}
              className="w-full py-3 bg-[#141e2b] text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-md group"
            >
              <span className="text-sm">Woning bekijken</span>
              <ExternalLink size={16} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <button
              onClick={openMakelaarMessage}
              className="w-full py-3 border-2 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-sm group bg-white border-[#141e2b] text-[#141e2b] hover:bg-slate-50"
            >
              <span className="text-sm">Bericht makelaar</span>
              <MessageSquare size={16} className="group-hover:scale-110 transition-transform" />
            </button>
            <button
              onClick={openKlantMessage}
              className="w-full py-3 border-2 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-sm group bg-white border-[#e67e22] text-[#e67e22] hover:bg-orange-50"
            >
              <span className="text-sm">Bericht klant</span>
              <UserCheck size={16} className="group-hover:scale-110 transition-transform" />
            </button>
            <button
              onClick={handleAddInteressant}
              className="w-full py-3 border-2 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-sm group bg-emerald-50 border-emerald-500 text-emerald-700 hover:bg-emerald-100"
            >
              <span className="text-sm">Interessant!</span>
              <span className="text-lg font-black group-hover:scale-110 transition-transform">+</span>
            </button>
            <button
              onClick={() => {
                setPlannenStatus('idle');
                setPlannenTaskText('Bezichtiging plannen');
                setShowPlannenModal(true);
              }}
              className="w-full py-3 border-2 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-sm group bg-blue-50 border-blue-500 text-blue-700 hover:bg-blue-100 col-span-2 lg:col-span-1"
            >
              <span className="text-sm">Bezichtiging plannen</span>
              <Calendar size={16} className="group-hover:scale-110 transition-transform" />
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
};

const KlantenView = ({ 
  klanten, 
  onAddKlant, 
  refreshing, 
  onRefresh,
  onDeleteKlant,
  onEditKlant,
  deletingId,
  onShowMatchesForKlant,
  selectedStatuses,
  setSelectedStatuses
}: { 
  klanten: any[], 
  onAddKlant: () => void, 
  refreshing: boolean, 
  onRefresh: () => void,
  onDeleteKlant: (id: string, name: string) => void,
  onEditKlant: (klant: any) => void,
  deletingId: string | null,
  onShowMatchesForKlant: (name: string) => void,
  selectedStatuses: string[],
  setSelectedStatuses: (statuses: string[]) => void
}) => {
  const displayedKlanten = useMemo(() => {
    return klanten.filter((klant) => {
      const s = (klant.Status || 'actief').toLowerCase();
      return selectedStatuses.includes(s);
    });
  }, [klanten, selectedStatuses]);

  return (
    <motion.div
      key="klanten-overzicht"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-white p-5 sm:p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-3 text-[#2d3e50]">
            <Users className="text-[#e67e22]" size={26} />
            Klanten Profielen
          </h2>
          <p className="text-slate-500 text-sm mt-1">Beheer actieve zoekprofielen via de Firebase database.</p>
        </div>
        <div className="flex flex-col xl:flex-row gap-3 xl:gap-4 items-center flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap bg-slate-50 p-1 rounded-xl border border-slate-200 shadow-inner">
            <span className="text-[10px] font-bold text-slate-400 uppercase px-2">Status:</span>
            {[
              { id: 'actief', label: 'Actief' },
              { id: 'prospect', label: 'Prospect' },
              { id: 'inactief', label: 'Inactief' },
              { id: 'aangekocht', label: 'Aangekocht' }
            ].map(option => {
              const isSelected = selectedStatuses.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    if (isSelected) {
                      setSelectedStatuses(selectedStatuses.filter(s => s !== option.id));
                    } else {
                      setSelectedStatuses([...selectedStatuses, option.id]);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer shadow-sm
                    ${isSelected 
                      ? option.id === 'actief' ? 'bg-emerald-500 border-emerald-600 text-white shadow-emerald-200'
                        : option.id === 'prospect' ? 'bg-blue-500 border-blue-600 text-white shadow-blue-200'
                        : option.id === 'inactief' ? 'bg-slate-600 border-slate-700 text-white shadow-slate-300'
                        : 'bg-amber-500 border-amber-600 text-white shadow-amber-200'
                      : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          
          <div className="flex gap-2 sm:gap-4 items-center">
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-3 rounded-xl font-bold transition-all disabled:opacity-50"
            >
              <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
              Data Verversen
            </button>
            <button
              onClick={onAddKlant}
              className="flex items-center justify-center gap-2 bg-[#000000] hover:bg-slate-800 text-white px-5 py-3 rounded-xl font-bold transition-all shadow-md hover:shadow-lg"
            >
              <UserPlus size={18} />
              Nieuw Profiel Toevoegen
            </button>
          </div>
        </div>
      </div>

      {displayedKlanten.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl shadow-sm border border-slate-100 text-center text-slate-500">
          <Users size={64} className="mx-auto mb-4 text-slate-300" />
          <h3 className="text-xl font-bold text-slate-700 mb-2">Geen klanten gevonden</h3>
          <p>Pas de statusfilters hierboven aan of druk op 'Data verversen' om profielen op te halen.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {displayedKlanten.map((klant, idx) => {
            const klantId = klant.id;
            const isDeleting = deletingId === klantId;

            const s = (klant.Status || 'actief').toLowerCase();
            let statusBg = 'bg-emerald-50', badgeBg = 'bg-emerald-100', badgeText = 'text-emerald-800', badgeRing = 'ring-emerald-600/30', badgeLabel = 'Actief Profiel';
            if (s === 'prospect') { statusBg = 'bg-blue-50'; badgeBg = 'bg-blue-100'; badgeText = 'text-blue-800'; badgeRing = 'ring-blue-600/30'; badgeLabel = 'Prospect'; }
            else if (s === 'inactief') { statusBg = 'bg-slate-100'; badgeBg = 'bg-slate-200'; badgeText = 'text-slate-800'; badgeRing = 'ring-slate-600/30'; badgeLabel = 'Inactief'; }
            else if (s === 'aangekocht') { statusBg = 'bg-amber-50'; badgeBg = 'bg-amber-100'; badgeText = 'text-amber-800'; badgeRing = 'ring-amber-600/30'; badgeLabel = 'Aangekocht'; }

            return (
              <div key={idx} className={`${statusBg} rounded-3xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow relative group`}>
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#e67e22] to-orange-400 flex items-center justify-center text-white font-bold text-lg shadow-sm">
                    {klant.Naam ? klant.Naam.charAt(0).toUpperCase() : '?'}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-[#2d3e50]">{klant.Naam || 'Naamloos Profiel'}</h3>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${badgeBg} ${badgeText} text-xs font-bold ring-1 ring-inset ${badgeRing}`}>
                      {badgeLabel}
                    </span>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <dt className="text-xs font-bold text-slate-400 tracking-wider uppercase mb-1">Budget</dt>
                    <dd className="font-semibold text-slate-700">{klant.Prijsklasse || 'Niet ingevuld'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-slate-400 tracking-wider uppercase mb-1">Regio</dt>
                    <dd className="text-sm font-medium text-slate-600 leading-relaxed">
                      {klant.Regio || 'Niet ingevuld'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-slate-400 tracking-wider uppercase mb-1">Woningtype</dt>
                    <dd className="text-sm font-medium text-slate-600 leading-relaxed">
                      {klant.Woningtype || 'Geen woningtype'}
                    </dd>
                  </div>
                  {(klant['Bijzondere Kenmerken'] || klant.BijzondereKenmerken) && (
                    <div className="pt-1">
                      <dt className="text-[10px] font-bold text-rose-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                        ⚠️ Essentieel
                      </dt>
                      <dd className="text-xs font-medium text-slate-700 leading-relaxed bg-rose-50/80 p-2 rounded-lg border border-rose-100/50">
                        {klant['Bijzondere Kenmerken'] || klant.BijzondereKenmerken}
                      </dd>
                    </div>
                  )}
                  {klant.Notities && (
                    <div className="pt-1">
                      <dt className="text-xs font-bold text-slate-400 tracking-wider uppercase mb-1">Extra Notities</dt>
                      <dd className="text-sm font-medium text-slate-600 leading-relaxed italic">
                        {klant.Notities}
                      </dd>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="mt-6 flex flex-col gap-2.5">
                  <button 
                    onClick={() => onShowMatchesForKlant(klant.Naam)}
                    className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-sm hover:shadow-md active:scale-98"
                  >
                    <Sparkles size={18} />
                    Matches Bekijken
                  </button>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => onEditKlant(klant)}
                      className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
                    >
                      <Pencil size={18} />
                      Bewerken
                    </button>
                    <button 
                      onClick={() => onDeleteKlant(klantId, klant.Naam)}
                      disabled={isDeleting}
                      className={`flex-1 py-2.5 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
                        isDeleting 
                        ? 'bg-red-100 text-red-400 cursor-not-allowed' 
                        : 'bg-red-50 text-red-600 hover:bg-red-100'
                      }`}
                    >
                      {isDeleting ? <RefreshCw size={18} className="animate-spin" /> : <Trash2 size={18} />}
                      {isDeleting ? 'Verwijderen...' : 'Verwijderen'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
};


// ── Helper componenten voor specifieke wensen ──────────────────────────────
function CheckboxGroup({ title, items, selected, onChange }: {
  title: string; items: string[]; selected: string[];
  onChange: (vals: string[]) => void;
}) {
  const col1 = items.filter((_, i) => i % 3 === 0);
  const col2 = items.filter((_, i) => i % 3 === 1);
  const col3 = items.filter((_, i) => i % 3 === 2);
  return (
    <div className="border-t border-slate-100 pt-3">
      <p className="text-xs font-semibold text-slate-700 mb-2">{title}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 sm:gap-x-6">
        {[col1, col2, col3].map((col, ci) => (
          <div key={ci}>
            {col.map(item => (
              <label key={item} className="flex items-center gap-1.5 text-xs mb-1.5 cursor-pointer hover:text-blue-600">
                <input
                  type="checkbox"
                  checked={selected.includes(item)}
                  onChange={e => onChange(e.target.checked ? [...selected, item] : selected.filter(v => v !== item))}
                  className="accent-blue-500 w-3.5 h-3.5"
                />
                {item}
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function OnderhoudGroup({ title, fieldName, value, onChange }: {
  title: string; fieldName: string; value: string; onChange: (v: string) => void;
}) {
  const opts = ['Slecht','Slecht tot matig','Matig','Matig tot redelijk','Redelijk','Redelijk tot goed','Goed','Goed tot uitstekend','Uitstekend'];
  return (
    <div className="border-t border-slate-100 pt-3">
      <p className="text-xs font-semibold text-slate-700 mb-2">{title}</p>
      <div className="grid grid-cols-3 gap-x-6">
        {[opts.slice(0,3), opts.slice(3,6), opts.slice(6)].map((col, ci) => (
          <div key={ci}>
            {col.map(opt => (
              <label key={opt} className="flex items-center gap-1.5 text-xs mb-1.5 cursor-pointer hover:text-blue-600">
                <input type="radio" name={fieldName} value={opt} checked={value === opt}
                  onChange={() => onChange(opt)} className="accent-blue-500 w-3.5 h-3.5" />
                {opt}
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
// ── Map Selector Component ────────────────────────────────────────────────
const MapSelector = ({ selectedLocations, selectedCoords, onSelect }: { 
  selectedLocations: string[], 
  selectedCoords: Record<string, [number, number]>,
  onSelect: (loc: string, coords: [number, number]) => void 
}) => {
  const mapRef = React.useRef<any>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const markersGroupRef = React.useRef<any>(null);
  const lastHoverTime = React.useRef<number>(0);
  const hoverTooltipRef = React.useRef<any>(null);

  // Initialization
  React.useEffect(() => {
    if (!containerRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    mapRef.current = L.map(containerRef.current, {
      center: [51.2, 5.9],
      zoom: 9,
      scrollWheelZoom: true,
      zoomControl: false // Custom placement later
    });

    L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '©OpenStreetMap ©CartoDB'
    }).addTo(mapRef.current);

    markersGroupRef.current = L.layerGroup().addTo(mapRef.current);
    
    // Create a hidden tooltip that we move around
    hoverTooltipRef.current = L.tooltip({
      sticky: true,
      direction: 'top',
      offset: [0, -10],
      opacity: 0.9,
      className: 'map-hover-tooltip'
    });

    // Hover handler with throttling (600ms)
    const handleMouseMove = async (e: any) => {
       const now = Date.now();
       if (now - lastHoverTime.current < 600) return;
       lastHoverTime.current = now;

       const { lat, lng } = e.latlng;
       try {
         const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=12&addressdetails=1`);
         const data = await res.json();
         const name = data.address.city || data.address.town || data.address.village || data.address.suburb || data.address.neighbourhood || (data.display_name && data.display_name.split(',')[0]);
         
         if (name && mapRef.current) {
            hoverTooltipRef.current
              .setLatLng(e.latlng)
              .setContent(`<div class="px-2 py-1 flex items-center gap-2"><span class="text-blue-500">📍</span> <span class="font-bold">${name}</span></div>`)
              .addTo(mapRef.current);
         }
       } catch (err) {}
    };

    mapRef.current.on('mousemove', handleMouseMove);

    // Click handler
    mapRef.current.on('click', async (e: any) => {
      const { lat, lng } = e.latlng;
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=12&addressdetails=1`);
        const data = await res.json();
        const name = data.address.city || data.address.town || data.address.village || data.address.suburb || data.address.neighbourhood || (data.display_name && data.display_name.split(',')[0]);
        
        if (name) {
          onSelect(name, [lat, lng]);
        }
      } catch (err) {}
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.off('mousemove', handleMouseMove);
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update Markers
  React.useEffect(() => {
    if (!mapRef.current || !markersGroupRef.current) return;
    const L = (window as any).L;
    markersGroupRef.current.clearLayers();

    selectedLocations.forEach(name => {
      const coords = selectedCoords[name];
      if (coords) {
        const marker = L.marker(coords, {
          icon: L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="background-color: #3b82f6; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
          })
        }).addTo(markersGroupRef.current);
        marker.bindTooltip(name, { permanent: false, direction: 'top' });
      } else {
        // Optionale Geocoding für Namen die per Text eingegeben wurden
        // Hier voor Performance weggelassen, of man macht es einmalig
      }
    });
  }, [selectedLocations, selectedCoords]);

  return (
    <>
      <style>{`
        .map-hover-tooltip {
          background: white !important;
          border: 1px solid #e2e8f0 !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1) !important;
          color: #1e293b !important;
          font-size: 12px !important;
          padding: 0 !important;
        }
        .map-hover-tooltip::before { border-top-color: #e2e8f0 !important; }
        .leaflet-container { cursor: crosshair !important; }
      `}</style>
      <div ref={containerRef} className="w-full h-full min-h-[360px] rounded border border-slate-300" />
    </>
  );
};
// ───────────────────────────────────────────────────────────────────────────



const MOCK_EUROPEAN_INTERIOR_IMAGES = [
  'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&q=80&w=800',
  'https://images.unsplash.com/photo-1445116572660-236099ec97a0?auto=format&fit=crop&q=80&w=800',
  'https://images.unsplash.com/photo-1495474472207-464a4f15d862?auto=format&fit=crop&q=80&w=800',
  'https://images.unsplash.com/photo-1481833761820-0509d3217039?auto=format&fit=crop&q=80&w=800',
  'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&q=80&w=800',
  'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&q=80&w=800',
  'https://images.unsplash.com/photo-1499916078039-922301b0eb9b?auto=format&fit=crop&q=80&w=800'
];

const getRandomImage = () => MOCK_EUROPEAN_INTERIOR_IMAGES[Math.floor(Math.random() * MOCK_EUROPEAN_INTERIOR_IMAGES.length)];

const BlogPostMakerView = () => {
  const [topic, setTopic] = useState('');
  const [step, setStep] = useState<'input' | 'titles' | 'content'>('input');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isGeneratingText, setIsGeneratingText] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [customTextPrompt, setCustomTextPrompt] = useState('');
  const [titles, setTitles] = useState<string[]>([]);
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [postContent, setPostContent] = useState('');
  const [postImage, setPostImage] = useState('');

  const generateTitles = async () => {
    if (!topic.trim()) return;
    setIsGenerating(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('http://localhost:3001/api/generate-blog-titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ topic })
      });
      const data = await res.json();
      if (data.titles) {
        setTitles(data.titles);
        setStep('titles');
      } else {
        alert('Kon geen titels genereren (controleer GEMINI_API_KEY in .env op poort 3001)');
      }
    } catch (err) {
      console.error(err);
      alert('Fout bij verbinden met backend.');
    } finally {
      setIsGenerating(false);
    }
  };

  const generateContent = async () => {
    if (!selectedTitle) return;
    setIsGenerating(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const contentPromise = fetch('http://localhost:3001/api/generate-blog-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ title: selectedTitle })
      }).then(res => res.json());

      const imagePromise = fetch('http://localhost:3001/api/generate-blog-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ title: selectedTitle })
      }).then(res => res.json()).catch(() => ({}));

      const [contentData, imageData] = await Promise.all([contentPromise, imagePromise]);
      
      if (contentData.content) {
        setPostContent(contentData.content);
        if (imageData.image) {
          setPostImage(imageData.image);
        } else {
          setPostImage(getRandomImage());
          alert('Opmerking: Nano Banana kon de afbeelding momenteel niet genereren. Er is een tijdelijke standaardafbeelding getoond.');
        }
        setStep('content');
      } else {
        alert('Kon geen content genereren (controleer GEMINI_API_KEY in .env)');
      }
    } catch (err) {
      console.error(err);
      alert('Fout bij verbinden met backend.');
    } finally {
      setIsGenerating(false);
    }
  };

  const generateNewImage = async () => {
    if (!selectedTitle) return;
    setIsGeneratingImage(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('http://localhost:3001/api/generate-blog-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ title: selectedTitle, customPrompt: customPrompt })
      });
      const data = await res.json();
      if (data.image) {
        setPostImage(data.image);
      } else {
        alert('Nano Banana kon de afbeelding niet genereren: ' + (data.error || 'Onbekende fout'));
      }
    } catch (err) {
      console.error(err);
      alert('Kon geen nieuwe afbeelding genereren wegens verbindingsfout.');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const generateNewText = async () => {
    if (!selectedTitle) return;
    setIsGeneratingText(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('http://localhost:3001/api/generate-blog-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ title: selectedTitle, customPrompt: customTextPrompt })
      });
      const data = await res.json();
      if (data.content) {
        setPostContent(data.content);
      } else {
        alert('Gemini kon de tekst niet opnieuw genereren: ' + (data.error || 'Onbekende fout'));
      }
    } catch (err) {
      console.error(err);
      alert('Kon geen nieuwe tekst genereren wegens verbindingsfout.');
    } finally {
      setIsGeneratingText(false);
    }
  };

  const downloadBlogPackage = () => {
    if (!selectedTitle) return;

    // 1. Download Text File
    const textBlob = new Blob([postContent], { type: 'text/plain;charset=utf-8' });
    const textUrl = URL.createObjectURL(textBlob);
    const textLink = document.createElement('a');
    textLink.href = textUrl;
    textLink.download = `${selectedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`;
    document.body.appendChild(textLink);
    textLink.click();
    document.body.removeChild(textLink);
    URL.revokeObjectURL(textUrl);

    // 2. Download Image File
    if (postImage && postImage.startsWith('data:')) {
      const imageLink = document.createElement('a');
      imageLink.href = postImage;
      imageLink.download = `${selectedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`;
      document.body.appendChild(imageLink);
      imageLink.click();
      document.body.removeChild(imageLink);
    }
  };

  return (
    <motion.div
      key="blog-post-maker"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="mt-8"
    >
      <div className="bg-white rounded-3xl shadow-xl p-8 lg:p-12 border border-slate-100 min-h-[600px] flex flex-col">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-[#e8f4fb] to-[#cfe2f3] rounded-2xl flex items-center justify-center text-[#5b9bd5] shadow-sm border border-[#cfe2f3]">
            <PenTool size={32} strokeWidth={1.5} />
          </div>
          <div>
            <h2 className="text-3xl font-bold text-[#141e2b]">Blog Post Maker</h2>
            <p className="text-slate-500 font-medium">Genereer razendsnel content met AI</p>
          </div>
        </div>



        {step === 'input' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col justify-center max-w-2xl w-full mx-auto">
            <div className="bg-slate-50 p-8 rounded-2xl border border-slate-100">
              <label className="block text-sm font-bold text-slate-700 mb-3">Waar wil je over schrijven?</label>
              <input 
                type="text" 
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Bijv. Een huis kopen in 2026, tips voor bezichtigingen..."
                className="w-full px-4 py-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#5b9bd5] text-lg mb-6 shadow-sm"
                onKeyDown={(e) => e.key === 'Enter' && generateTitles()}
              />
              <button 
                onClick={generateTitles}
                disabled={!topic.trim() || isGenerating}
                className="w-full py-4 bg-[#5b9bd5] hover:bg-[#4a8ac4] disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg"
              >
                {isGenerating ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {isGenerating ? 'AI is aan het nadenken...' : 'Genereer Titels'}
              </button>
            </div>

          </motion.div>
        )}

        {step === 'titles' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 max-w-3xl w-full mx-auto">
            <h3 className="text-xl font-bold text-[#141e2b] mb-6 flex items-center gap-2">
              <Check className="text-emerald-500" /> Kies een pakkende titel:
            </h3>
            <div className="space-y-4 mb-8">
              {titles.map((t, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedTitle(t)}
                  className={`w-full text-left p-5 rounded-xl border-2 transition-all ${selectedTitle === t ? 'border-[#5b9bd5] bg-[#e8f4fb] shadow-md' : 'border-slate-100 hover:border-[#cfe2f3] hover:bg-slate-50'}`}
                >
                  <p className={`text-lg font-semibold ${selectedTitle === t ? 'text-[#1a5c8a]' : 'text-slate-700'}`}>{t}</p>
                </button>
              ))}
            </div>
            <div className="flex gap-4">
              <button 
                onClick={() => setStep('input')}
                className="px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all"
              >
                Terug
              </button>
              <button 
                onClick={generateContent}
                disabled={!selectedTitle || isGenerating}
                className="flex-1 py-4 bg-[#5b9bd5] hover:bg-[#4a8ac4] disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg"
              >
                {isGenerating ? <Loader2 className="animate-spin" /> : <FileText />}
                {isGenerating ? 'Content genereren...' : 'Genereer Tekst & Afbeelding'}
              </button>
            </div>
          </motion.div>
        )}

        {step === 'content' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-bold text-[#141e2b]">{selectedTitle}</h3>
              <button onClick={() => { setStep('input'); setTopic(''); setSelectedTitle(null); setCustomPrompt(''); setCustomTextPrompt(''); }} className="text-[#5b9bd5] hover:text-[#4a8ac4] text-sm font-bold flex items-center gap-1">
                <RefreshCw size={14} /> Nieuwe Post
              </button>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                <div className="flex items-center gap-2 mb-4 text-slate-400 font-bold uppercase tracking-widest text-xs">
                  <ImageIcon size={14} /> Gegenereerde Afbeelding
                </div>
                <div className="relative w-full h-64 mb-4 rounded-xl overflow-hidden shadow-sm bg-slate-200">
                  <img src={postImage} alt={selectedTitle || 'Blog afbeelding'} className={`w-full h-full object-cover transition-opacity duration-300 ${isGeneratingImage ? 'opacity-40' : 'opacity-100'}`} />
                  {isGeneratingImage && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/10 backdrop-blur-xs">
                      <Loader2 className="animate-spin text-[#5b9bd5] mb-2" size={32} />
                      <span className="text-sm font-bold text-slate-700 bg-white/80 px-3 py-1 rounded-full shadow-xs">Nano Banana is aan het tekenen...</span>
                    </div>
                  )}
                </div>
                {/* Custom Image Prompt Input */}
                <div className="mb-4">
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Eigen Afbeeldingsomschrijving (Optioneel)
                  </label>
                  <input
                    type="text"
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="Bijv. Een modern huis met zonnepanelen, of laat leeg voor automatische prompt..."
                    className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#5b9bd5] bg-white shadow-xs text-slate-700 placeholder-slate-400"
                    disabled={isGeneratingImage}
                    onKeyDown={(e) => e.key === 'Enter' && generateNewImage()}
                  />
                </div>

                <button 
                  onClick={generateNewImage} 
                  disabled={isGeneratingImage}
                  className={`w-full py-3 border font-bold flex items-center justify-center gap-2 transition-all rounded-xl ${
                    isGeneratingImage 
                      ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                      : 'bg-[#5b9bd5] hover:bg-[#4a8ac4] text-white border-[#5b9bd5] hover:border-[#4a8ac4] active:scale-95 shadow-sm'
                  }`}
                >
                  {isGeneratingImage ? <Loader2 className="animate-spin" size={18} /> : <ImageIcon size={18} />}
                  {isGeneratingImage ? 'Nieuwe afbeelding tekenen...' : 'Andere Afbeelding Genereren'}
                </button>
              </div>
              
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                <div className="flex items-center gap-2 mb-4 text-slate-400 font-bold uppercase tracking-widest text-xs">
                  <FileText size={14} /> Gegenereerde Tekst
                </div>
                <div className="relative w-full mb-4">
                  <textarea 
                    value={postContent}
                    onChange={(e) => setPostContent(e.target.value)}
                    disabled={isGeneratingText}
                    className={`w-full h-64 p-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#5b9bd5] bg-white leading-relaxed text-slate-700 resize-none transition-opacity duration-300 ${isGeneratingText ? 'opacity-40' : 'opacity-100'}`}
                  />
                  {isGeneratingText && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/10 backdrop-blur-xs rounded-xl">
                      <Loader2 className="animate-spin text-[#5b9bd5] mb-2" size={32} />
                      <span className="text-sm font-bold text-slate-700 bg-white/80 px-3 py-1 rounded-full shadow-xs">Gemini is aan het schrijven...</span>
                    </div>
                  )}
                </div>

                {/* Custom Text Prompt Input */}
                <div className="mb-4">
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Aanwijzingen voor de tekst (Optioneel)
                  </label>
                  <input
                    type="text"
                    value={customTextPrompt}
                    onChange={(e) => setCustomTextPrompt(e.target.value)}
                    placeholder="Bijv. Maak de toon wat enthousiaster, of focus meer op starters..."
                    className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#5b9bd5] bg-white shadow-xs text-slate-700 placeholder-slate-400"
                    disabled={isGeneratingText}
                    onKeyDown={(e) => e.key === 'Enter' && generateNewText()}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={generateNewText}
                    disabled={isGeneratingText}
                    className={`py-3 border font-bold flex items-center justify-center gap-2 transition-all rounded-xl text-sm ${
                      isGeneratingText 
                        ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                        : 'bg-[#5b9bd5] hover:bg-[#4a8ac4] text-white border-[#5b9bd5] hover:border-[#4a8ac4] active:scale-95 shadow-sm'
                    }`}
                  >
                    {isGeneratingText ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                    {isGeneratingText ? 'Schrijven...' : 'Tekst Opnieuw'}
                  </button>
                  <button 
                    onClick={() => navigator.clipboard.writeText(postContent)} 
                    disabled={isGeneratingText}
                    className="py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-xs active:scale-95 text-sm"
                  >
                    <Copy size={18} /> Kopieer Content
                  </button>
                </div>
              </div>
            </div>

            {/* Unified Export/Download Button */}
            <div className="mt-8 flex justify-end">
              <button 
                onClick={downloadBlogPackage}
                disabled={isGeneratingImage || isGeneratingText}
                className={`px-8 py-4 font-bold flex items-center justify-center gap-3 transition-all rounded-xl shadow-md text-base ${
                  isGeneratingImage || isGeneratingText 
                    ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                    : 'bg-[#5b9bd5] hover:bg-[#4a8ac4] text-white border border-[#5b9bd5] hover:border-[#4a8ac4] active:scale-95'
                }`}
              >
                <Download size={20} />
                Download Blog Pakket (.txt + .jpg)
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};

export default function App() {
  const [activeView, setActiveView] = useState<View>(() => {
    const saved = localStorage.getItem('woonwensActiveView');
    return (saved as View) || 'matches';
  });
  const [houseScans, setHouseScans] = useState<HouseScan[]>([]);
  const [previousHouseScans, setPreviousHouseScans] = useState<HouseScan[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [matchRuns, setMatchRuns] = useState<{ id: string; matches: any[]; datum: string }[]>([]);
  const [currentRunIndex, setCurrentRunIndex] = useState(0);
  const [klantenLijst, setKlantenLijst] = useState<any[]>([]);
  const [klantSearchTerm, setKlantSearchTerm] = useState('');
  const sortedKlantenLijst = useMemo(() => {
    const getStatusPriority = (status?: string) => {
      const s = (status || 'actief').toLowerCase();
      if (s === 'actief') return 1;
      if (s === 'prospect') return 2;
      return 3;
    };
    const filtered = klantenLijst.filter(k => 
      !klantSearchTerm || 
      (k.Naam && k.Naam.toLowerCase().includes(klantSearchTerm.toLowerCase()))
    );
    return filtered.sort((a, b) => {
      const prioA = getStatusPriority(a.Status);
      const prioB = getStatusPriority(b.Status);
      if (prioA !== prioB) return prioA - prioB;
      return (a.Naam || '').localeCompare(b.Naam || '', 'nl');
    });
  }, [klantenLijst, klantSearchTerm]);
  const [clientMatchFilter, setClientMatchFilter] = useState<string | null>(null);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['actief', 'prospect']);
  const [loading, setLoading] = useState(true);
  const [loadingScans, setLoadingScans] = useState(true);
  const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
  const [currentNieuwsteRunIndex, setCurrentNieuwsteRunIndex] = useState(0);
  const [currentVorigeRunIndex, setCurrentVorigeRunIndex] = useState(1);
  
  // Database view state
  const [databaseScans, setDatabaseScans] = useState<HouseScan[]>([]);
  const [loadingDatabase, setLoadingDatabase] = useState(false);
  const [dbSearchTerm, setDbSearchTerm] = useState('');
  const [dbFilterPlaats, setDbFilterPlaats] = useState('Maastricht');
  const [dbFilterPrijsVan, setDbFilterPrijsVan] = useState<number | ''>(100000);
  const [dbFilterPrijsTot, setDbFilterPrijsTot] = useState<number | ''>(500000);
  const [dbFilterDatumVan, setDbFilterDatumVan] = useState('2026-04-02');
  const [dbFilterDatumTot, setDbFilterDatumTot] = useState('2026-06-01');
  const [dbFilterDagdeel, setDbFilterDagdeel] = useState('Alle');
  const [dbFilterNieuw, setDbFilterNieuw] = useState(false);

  const fetchDatabaseScans = async () => {
    try {
      setLoadingDatabase(true);
      // Begrens de query tot de laatste 5000 huizen om Firebase reads (en kosten) drastisch te beperken
      const snapshot = await getDocs(query(collection(db, 'NieuweHuizenPerScrape'), orderBy('sc Nummer', 'desc'), limit(5000)));
      const dbScans: HouseScan[] = [];
      snapshot.forEach(doc => {
        dbScans.push({ id: doc.id, ...doc.data() } as any);
      });
      setDatabaseScans(dbScans);
    } catch (error: any) {
      console.error('Error fetching database scans:', error);
      alert(`Fout bij ophalen database: ${error.message}`);
    } finally {
      setLoadingDatabase(false);
    }
  };

  useEffect(() => {
    if (activeView === 'database' && databaseScans.length === 0) {
      fetchDatabaseScans();
    }
  }, [activeView, databaseScans.length]);
  
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const groupedScans = useMemo(() => {
    const activeRun = scanRuns[currentNieuwsteRunIndex];
    const housesToShow = activeRun ? activeRun.houses : [];
    
    const grouped = housesToShow.reduce((acc, scan) => {
      const region = getRegion(scan.Plaats || '');
      if (!acc[region]) acc[region] = [];
      acc[region].push(scan);
      return acc;
    }, {} as Record<string, HouseScan[]>);
    return grouped;
  }, [scanRuns, currentNieuwsteRunIndex]);

  const groupedPreviousScans = useMemo(() => {
    const activeRun = scanRuns[currentVorigeRunIndex];
    const housesToShow = activeRun ? activeRun.houses : [];
    
    const grouped = housesToShow.reduce((acc, scan) => {
      const region = getRegion(scan.Plaats || '');
      if (!acc[region]) acc[region] = [];
      acc[region].push(scan);
      return acc;
    }, {} as Record<string, HouseScan[]>);
    return grouped;
  }, [scanRuns, currentVorigeRunIndex]);

  const regionOrder = ['Maastricht', 'heuvelland', 'parkstad', 'westelijke mijnstreek', 'Echt Roermond', 'overige'];
  
  useEffect(() => {
    localStorage.setItem('woonwensActiveView', activeView);
  }, [activeView]);

  const fetchScansDirectlyFromFirestore = async () => {
    try {
      console.log('📡 Scans ophalen...');
      let rawHouses: any[] = [];
      
      try {
        console.log('📡 Proberen via Express Backend API...');
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('http://localhost:3001/api/firestore-scans', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          rawHouses = await res.json();
          console.log(`📦 Aantal documenten opgehaald van backend: ${rawHouses.length}`);
        } else {
          throw new Error('Backend returned non-ok status');
        }
      } catch (backendErr) {
        console.warn('⚠️ Express Backend niet bereikbaar of firebase-admin.json mist. Fallback direct via Firebase Web SDK...');
        const querySnapshot = await getDocs(collection(db, 'NieuweHuizenPerScrape'));
        rawHouses = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        console.log(`📦 Aantal documenten direct geladen uit Firestore Web SDK: ${rawHouses.length}`);
      }

      // Normaliseer en verwerk de resultaten met de bestaande parseN8nScans helper
      const processedHouses = await parseN8nScans(rawHouses);

      // Groepeer op dag en dagdeel (Ochtend / Middag)
      const runsMap: Record<string, ScanRun> = {};

      const getRunKey = (datumStr: string) => {
        if (!datumStr || typeof datumStr !== 'string') return null;
        // Match format: "DD-MM HH:mm:ss" of "DD-MM HH:mm"
        const match = datumStr.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
        if (!match) {
          const d = new Date(datumStr);
          if (isNaN(d.getTime())) return null;
          const day = String(d.getDate()).padStart(2, '0');
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const hour = d.getHours();
          const isMorning = hour < 12;
          return {
            key: `${day}-${month}-${isMorning ? 'ochtend' : 'middag'}`,
            day,
            month,
            year: d.getFullYear(),
            hour,
            isMorning,
            dateObject: d
          };
        }
        
        const [_, day, month, hourStr] = match;
        const hour = parseInt(hourStr, 10);
        const isMorning = hour < 12;
        const year = 2026; // Veronderstel huidig jaar (2026)
        
        // Construeer een geldig datum-object voor sortering
        const dateObject = new Date(year, parseInt(month, 10) - 1, parseInt(day, 10), hour, 0, 0);
        
        return {
          key: `${day}-${month}-${isMorning ? 'ochtend' : 'middag'}`,
          day,
          month,
          year,
          hour,
          isMorning,
          dateObject
        };
      };

      for (const house of processedHouses) {
        const runInfo = getRunKey(house.Datum);
        if (!runInfo) continue;
        
        const { key, day, month, year, isMorning, dateObject } = runInfo;
        
        if (!runsMap[key]) {
          const weekdays = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
          const months = ['Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni', 'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December'];
          
          const weekdayName = weekdays[dateObject.getDay()];
          const monthName = months[dateObject.getMonth()];
          const dagdeelLabel = isMorning ? 'Ochtend' : 'Middag';
          const title = `${weekdayName} ${parseInt(day)} ${monthName} ${year} (${dagdeelLabel})`;
          
          runsMap[key] = {
            id: key,
            title,
            date: dateObject,
            houses: []
          };
        }
        
        runsMap[key].houses.push(house);
      }

      // Converteer map naar een chronologisch gesorteerde array (nieuwste eerst)
      const sortedRuns = Object.values(runsMap).sort((a, b) => b.date.getTime() - a.date.getTime());
      return sortedRuns;
    } catch (error) {
      console.error('Error fetching scans directly from Firestore:', error);
      return null;
    }
  };

  const fetchMatchesDirectlyFromFirestore = async () => {
    try {
      const matchesSnapshot = await getDocs(collection(db, 'matches'));
      const runs: any[] = [];

      matchesSnapshot.forEach((docSnap) => {
        const docId = docSnap.id;
        const docData = docSnap.data();
        const rawMatchesArray = docData.data || [];

        const mappedMatches = rawMatchesArray.map((m: any, index: number) => {
          const matchPercentage = parseInt(m.match_percentage) || 0;

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

        // Bepaal de datum van de run: geef de datum van de eerste match voorrang
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

      runs.sort((a, b) => b.id.localeCompare(a.id));
      return runs;
    } catch (err) {
      console.error('Error fetching matches directly from Firestore:', err);
      return null;
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      // 1. Eerst Matches en Klanten in parallel ophalen (snel, rechtstreeks uit Firestore/Express API)
      try {
        const matchesPromise = fetchMatchesDirectlyFromFirestore().then(async (directRuns) => {
          if (directRuns && directRuns.length > 0) {
            setMatchRuns(directRuns);
            setCurrentRunIndex(0);
            setMatches(directRuns[0].matches);
            console.log('📡 Matches succesvol RECHTSTREEKS uit Firestore geladen!');
          } else {
            // Fallback naar Express API
            const token = await auth.currentUser?.getIdToken();
            const matchesRes = await fetch('http://localhost:3001/api/matches', {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            const matchesData = await matchesRes.json();
            if (matchesData && Array.isArray(matchesData.runs)) {
              setMatchRuns(matchesData.runs);
              setCurrentRunIndex(0);
              if (matchesData.runs.length > 0) {
                setMatches(matchesData.runs[0].matches);
              }
              console.log('📡 Matches ingeladen via Express API (fallback).');
            }
          }
        }).catch((e) => console.error('Error fetching matches:', e));

        const klantenPromise = getDocs(collection(db, 'klanten')).then((klantenSnapshot) => {
          if (klantenSnapshot) {
            const fetchedKlanten = klantenSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setKlantenLijst(fetchedKlanten);
          }
        }).catch((e) => console.error('Error fetching klanten:', e));

        // Wacht tot de matches en klanten geladen zijn om de UI direct te deblokkeren
        await Promise.all([matchesPromise, klantenPromise]);
      } catch (err) {
        console.error('Error fetching fast data:', err);
      } finally {
        // Deblokkeer het matches/klanten scherm direct!
        setLoading(false);
      }

      // 2. Op de achtergrond (zonder het matches/klanten tabblad te blokkeren) de scans ophalen uit Firestore
      try {
        setLoadingScans(true);
        const directScans = await fetchScansDirectlyFromFirestore();
        if (directScans && directScans.length > 0) {
          setScanRuns(directScans);
          setCurrentNieuwsteRunIndex(0);
          setCurrentVorigeRunIndex(directScans.length > 1 ? 1 : 0);
          console.log('📡 Scans succesvol uit Firestore ingeladen en gegroepeerd!');
        }
      } catch (err) {
        console.error('Error fetching scans from Firestore:', err);
      } finally {
        setLoadingScans(false);
      }
    };
    
    fetchData();

  }, []);

  const [refreshing, setRefreshing] = useState(false);

  const refreshMatches = async () => {
    setRefreshing(true);
    try {
      const directRuns = await fetchMatchesDirectlyFromFirestore();
      if (directRuns && directRuns.length > 0) {
        setMatchRuns(directRuns);
        setCurrentRunIndex(0);
        setMatches(directRuns[0].matches);
        alert(`Succesvol ${directRuns[0].matches.length} matches RECHTSTREEKS uit Firestore ingeladen!`);
      } else {
        // Fallback to API
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('http://localhost:3001/api/matches', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const matchesData = await res.json();
        if (matchesData && Array.isArray(matchesData.runs)) {
          setMatchRuns(matchesData.runs);
          setCurrentRunIndex(0);
          if (matchesData.runs.length > 0) {
            setMatches(matchesData.runs[0].matches);
            alert(`Succesvol ${matchesData.runs[0].matches.length} matches ingeladen van run ${matchesData.runs[0].id} via API (fallback)!`);
          } else {
            setMatches([]);
            alert('Geen matches gevonden in Firestore (fallback).');
          }
        } else {
          alert('Fout bij verversen matches via API (fallback).');
        }
      }
    } catch (error) {
      console.error('Error refreshing matches:', error);
      alert('Er trad een fout op bij het verversen van de matches.');
    } finally {
      setRefreshing(false);
    }
  };

  const [refreshingScans, setRefreshingScans] = useState(false);
  const [showAddKlantModal, setShowAddKlantModal] = useState(false);
  const [addKlantStep, setAddKlantStep] = useState(1);
  const [locatieError, setLocatieError] = useState(false);
  const [showSpecifiekeWensen, setShowSpecifiekeWensen] = useState(false);
  const [refreshingKlanten, setRefreshingKlanten] = useState(false);
  const [deletingKlantId, setDeletingKlantId] = useState<string | null>(null);
  const [newKlant, setNewKlant] = useState({
    Naam: '', Regio: '', BijzonderhedenRegio: '',
    GeselecteerdeLocaties: [] as string[], GeselecteerdeCoords: {} as Record<string, [number, number]>, LocatieZoekterm: '', LocatieFilter: 'Alles',
    Soort: 'koop', Prijsklasse: '', PrijsMax: '', Bouwvorm: 'beide',
    Objectsoort: 'woonhuis_appartement', Woonoppervlakte: '', Perceeloppervlakte: '',
    AantalKamers: '', AantalSlaapkamers: '', Bestemming: ['permanente_bewoning'] as string[],
    DubbeleBewoning: [] as string[], Energielabel: '', Buitenruimte: [] as string[],
    TypeWoning: [] as string[], SoortWoning: [] as string[], SoortAppartement: [] as string[],
    Ligging: [] as string[], Bijzonderheden: [] as string[], Toegankelijkheid: [] as string[],
    OnderhoudBinnen: '', OnderhoudBuiten: '',
    Parkeren: [] as string[], Voorzieningen: [] as string[], Eigendom: [] as string[],
    BouwjaarVan: '', BouwjaarTm: '', MinMatchPercentage: '80', Prioriteiten: [] as string[],
    Email: '', Notificatie: 'direct', Notities: '', BijzondereKenmerken: '', Woningtype: '',
    StuurtEigenAanbod: true, AanbodVanaf: 'Afgelopen 2 weken', Status: 'actief',
  });
  const [submittingKlant, setSubmittingKlant] = useState(false);
  const [editingKlantId, setEditingKlantId] = useState<string | null>(null);

  // --- Manager Dashboard Action Modal State ---
  const [actionModal, setActionModal] = useState<{
    isOpen: boolean;
    type: 'bezichtiging' | 'bieding' | 'keuring' | 'contract' | 'interessante_woning';
    klantId: string;
    klantNaam: string;
    actionId?: string;
  } | null>(null);

  const [actionForm, setActionForm] = useState({
    adres: '',
    datum: '',
    tijd: '',
    notities: '',
    status: 'gepland',
    prijs: '',
    voorwaarden: [] as string[],
    koopsom: '',
    datumInvoer: '',
    datumFinanciering: '',
    datumBouwkundig: '',
    datumVerkoopEigen: '',
    datumWaarborgsom: '',
    datumTransport: '',
    notariskeuze: '',
    bedragFinanciering: '',
    heeftPersoonlijkBericht: false,
    aanvaardingstermijn: '',
    heeftNotariskeuze: false,
    notarisBieding: '',
    verkopendMakelaar: ''
  });

  const resetActionForm = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    setActionForm({
      adres: '',
      datum: '',
      tijd: '',
      notities: '',
      status: 'gepland',
      prijs: '',
      voorwaarden: [] as string[],
      koopsom: '',
      datumInvoer: todayStr,
      datumFinanciering: '',
      datumBouwkundig: '',
      datumVerkoopEigen: '',
      datumWaarborgsom: '',
      datumTransport: '',
      notariskeuze: '',
      bedragFinanciering: '',
      heeftPersoonlijkBericht: false,
      aanvaardingstermijn: '',
      heeftNotariskeuze: false,
      notarisBieding: '',
      verkopendMakelaar: ''
    });
  };

  const [researchStatus, setResearchStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [showFullReport, setShowFullReport] = useState(false);

  const handleFetchResearch = () => {
    if (!actionForm.adres) {
      alert("Vul eerst een adres in om research op te halen.");
      return;
    }
    setResearchStatus('loading');
    setTimeout(() => {
      setResearchStatus('success');
      setShowFullReport(true);
    }, 1500);
  };

  const openEditActionModal = (type: 'bezichtiging' | 'bieding' | 'keuring' | 'contract' | 'interessante_woning', klant: any, item: any) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const safeItem = item || {};
    setActionForm({
      adres: safeItem.adres || '',
      datum: safeItem.datum || '',
      tijd: safeItem.tijd || '',
      notities: safeItem.notities || '',
      status: safeItem.status || 'gepland',
      prijs: safeItem.prijs || safeItem.bedrag || '',
      voorwaarden: Array.isArray(safeItem.voorwaarden) ? safeItem.voorwaarden : [],
      koopsom: safeItem.koopsom || safeItem.prijs || safeItem.bedrag || '',
      datumInvoer: safeItem.datumInvoer || todayStr,
      datumFinanciering: safeItem.datumFinanciering || '',
      datumBouwkundig: safeItem.datumBouwkundig || '',
      datumVerkoopEigen: safeItem.datumVerkoopEigen || '',
      datumWaarborgsom: safeItem.datumWaarborgsom || '',
      datumTransport: safeItem.datumTransport || '',
      notariskeuze: safeItem.notariskeuze || '',
      bedragFinanciering: safeItem.bedragFinanciering || '',
      heeftPersoonlijkBericht: safeItem.heeftPersoonlijkBericht || false,
      aanvaardingstermijn: safeItem.aanvaardingstermijn || '',
      heeftNotariskeuze: safeItem.heeftNotariskeuze || false,
      notarisBieding: safeItem.notarisBieding || '',
      verkopendMakelaar: safeItem.verkopendMakelaar || ''
    });
    setActionModal({
      isOpen: true,
      type,
      klantId: klant?.id || '',
      klantNaam: klant?.Naam || '',
      actionId: safeItem.id || ''
    });
    setResearchStatus('idle'); // Reset research status when opening modal
  };

  const handleUpdateBezichtigingField = async (klantId: string, bezichtigingId: string, field: string, value: any) => {
    try {
      const klant = klantenLijst.find(k => k.id === klantId);
      if (!klant) return;

      const existingArray = klant.bezichtigingen || [];
      const previousItem = existingArray.find((item: any) => item.id === bezichtigingId);
      const isStatusTransitionToGeweest = field === 'status' && value === 'geweest' && previousItem?.status !== 'geweest';

      const updatedArray = existingArray.map((item: any) => {
        if (item.id === bezichtigingId) {
          return { ...item, [field]: value };
        }
        return item;
      });

      const klantRef = doc(db, 'klanten', klantId);
      await updateDoc(klantRef, {
        bezichtigingen: updatedArray
      });

      setKlantenLijst(prev => prev.map(k => {
        if (k.id === klantId) {
          return { ...k, bezichtigingen: updatedArray };
        }
        return k;
      }));

      // Automatically recalculate viewing reminders if 'datum' or 'tijd' was updated inline
      if ((field === 'datum' || field === 'tijd') && previousItem) {
        const item = updatedArray.find((item: any) => item.id === bezichtigingId);
        const datum = item.datum || '';
        const tijd = item.tijd || '12:00';
        
        if (datum) {
          const addedReminders = await triggerBezichtigingReminders(
            klant.Naam || '',
            item.adres || '',
            datum,
            tijd
          );
          if (addedReminders && addedReminders.length > 0) {
            const reminderListStr = addedReminders.map((r: any) => {
              let displayTxt = r.text;
              if (r.woning && displayTxt.includes('[betreft bezichtiging]')) {
                displayTxt = displayTxt.replace('[betreft bezichtiging]', r.woning);
              }
              return `• [${formatDateToNL(r.dueDate)}] ${displayTxt}`;
            }).join('\n');
            alert(`Bezichtigingsdata bijgewerkt!\n\nDe volgende herinneringen zijn aangepast in je dashboard Takenlijst:\n\n${reminderListStr}`);
          }
        }
      }

    } catch (err) {
      console.error('Error updating bezichtiging field:', err);
      alert('Fout bij bijwerken van bezichtiging in Firebase.');
    }
  };

  const formatDateToNL = (dateStr: string): string => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  };

  const formatDateToDutchWords = (dateStr: string): string => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const months = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
    const day = parseInt(parts[2], 10);
    const month = months[parseInt(parts[1], 10) - 1];
    const year = parts[0];
    return `${day} ${month} ${year}`;
  };

  const calculateOneHourBefore = (timeStr: string): string => {
    if (!timeStr) return '11:00';
    const [hours, minutes] = timeStr.split(':');
    let h = parseInt(hours, 10) - 1;
    if (h < 0) h = 23;
    return `${String(h).padStart(2, '0')}:${minutes}`;
  };

  const addDaysGlobal = (dateStr: string | undefined, days: number): string => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime())) {
        d.setDate(d.getDate() + days);
        const yStr = d.getFullYear();
        const mStr = String(d.getMonth() + 1).padStart(2, '0');
        const dStr = String(d.getDate()).padStart(2, '0');
        return `${yStr}-${mStr}-${dStr}`;
      }
    }
    return dateStr;
  };

  const triggerContractReminders = async (
    klantNaam: string,
    adres: string,
    data: {
      datumInvoer?: string;
      datumFinanciering?: string;
      datumBouwkundig?: string;
      datumVerkoopEigen?: string;
      datumWaarborgsom?: string;
      datumTransport?: string;
      voorwaarden?: string[];
      verkopendMakelaar?: string;
    }
  ) => {
    try {
      console.log('Triggering contract reminders for:', klantNaam, adres, data);
      const contractReminderTitles = [
        "Herinnering gegevens klant aangeleverd?",
        "Herinnering: Reeds concept koopovk??",
        "Herinnering: Afspraak gemaakt met klant voor bespreken concept koopovereenkomst?",
        "Herinnering: Goedkeuring geven op concept koopakte",
        "Herinnering: Tekenafspraak gepland",
        "Herinnering: Getekende koopovereenkomst ontvangen??",
        "Herinnering: Klant en hypotheekadviseur getekende koopovereenkomst ontvangen??",
        "Mail notaris: Aanmelding als zijnde aankoopmakelaar (standaard mail)",
        "Bouwkundige ingeschakeld?",
        "Taxateur ingeschakeld?",
        "Opvolging financieringstermijn",
        "Opvolging Reeds terugkoppeling bouwkundige",
        "Opvolging verkoop eigen woning",
        "Waarborgsom gestort??",
        "Concept leveringsakte ontvangen?",
        "Concept leveringsakte besproken met aankoopklant",
        "Nagaan of eindinspectie gepland is??",
        "Courtagenota sturen naar klant"
      ];

      // 1. Delete existing automated reminders for this customer and property
      const q = query(
        collection(db, 'tasks'),
        where('klant', '==', klantNaam),
        where('woning', '==', adres)
      );
      const querySnapshot = await getDocs(q);
      const deletePromises: Promise<any>[] = [];
      querySnapshot.forEach((docSnap) => {
        const taskData = docSnap.data();
        const text = taskData.text || '';
        const shouldDelete = contractReminderTitles.some(title => text.startsWith(title));
        if (shouldDelete) {
          deletePromises.push(deleteDoc(doc(db, 'tasks', docSnap.id)));
        }
      });
      await Promise.all(deletePromises);

      // 2. Date arithmetic helper
      const addDays = (dateStr: string | undefined, days: number): string => {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length !== 3) return '';
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        const d = new Date(year, month - 1, day);
        if (isNaN(d.getTime())) return '';
        d.setDate(d.getDate() + days);
        const yStr = d.getFullYear();
        const mStr = String(d.getMonth() + 1).padStart(2, '0');
        const dStr = String(d.getDate()).padStart(2, '0');
        return `${yStr}-${mStr}-${dStr}`;
      };

      const datumInvoer = data.datumInvoer || new Date().toISOString().split('T')[0];

      // 3. Prepare payload array
      const newReminders: any[] = [];

      const baseReminders = [
        { text: "Herinnering gegevens klant aangeleverd?", offset: 0 },
        { text: "Herinnering: Reeds concept koopovk??", offset: 2 },
        { text: "Herinnering: Afspraak gemaakt met klant voor bespreken concept koopovereenkomst?", offset: 3 },
        { text: "Herinnering: Goedkeuring geven op concept koopakte", offset: 4 },
        { text: "Herinnering: Tekenafspraak gepland", offset: 5 },
        { text: "Herinnering: Getekende koopovereenkomst ontvangen??", offset: 7 },
        { text: "Herinnering: Klant en hypotheekadviseur getekende koopovereenkomst ontvangen??", offset: 9 },
        { text: "Mail notaris: Aanmelding als zijnde aankoopmakelaar (standaard mail)", offset: 11 }
      ];

      for (const item of baseReminders) {
        const date = addDays(datumInvoer, item.offset);
        if (date) {
          newReminders.push({
            text: `${item.text} (Concept: ${formatDateToNL(datumInvoer)})`,
            done: false,
            type: 'herinnering',
            dueDate: date,
            dueTime: '12:00',
            klant: klantNaam,
            woning: adres,
            createdAt: new Date().toISOString()
          });
        }
      }

      // Conditional reminders (9 days after invoer)
      if (data.datumBouwkundig) {
        const date = addDays(datumInvoer, 9);
        if (date) {
          newReminders.push({
            text: `Bouwkundige ingeschakeld? (Deadline: ${formatDateToNL(data.datumBouwkundig)})`,
            done: false,
            type: 'herinnering',
            dueDate: date,
            dueTime: '12:00',
            klant: klantNaam,
            woning: adres,
            createdAt: new Date().toISOString()
          });
        }
      }

      if (data.datumFinanciering) {
        const date = addDays(datumInvoer, 9);
        if (date) {
          newReminders.push({
            text: `Taxateur ingeschakeld? (Deadline financiering: ${formatDateToNL(data.datumFinanciering)})`,
            done: false,
            type: 'herinnering',
            dueDate: date,
            dueTime: '12:00',
            klant: klantNaam,
            woning: adres,
            createdAt: new Date().toISOString()
          });
        }
      }

      // Relative reminders (terugrekenen vanaf specifieke velden)
      if (data.datumFinanciering) {
        const date = addDays(data.datumFinanciering, -5);
        if (date) {
          newReminders.push({
            text: `Opvolging financieringstermijn (${formatDateToNL(data.datumFinanciering)})`,
            done: false,
            type: 'herinnering',
            dueDate: date,
            dueTime: '12:00',
            klant: klantNaam,
            woning: adres,
            createdAt: new Date().toISOString()
          });
        }
      }

      if (data.datumBouwkundig) {
        const date = addDays(data.datumBouwkundig, -3);
        if (date) {
          newReminders.push({
            text: `Opvolging Reeds terugkoppeling bouwkundige (${formatDateToNL(data.datumBouwkundig)})`,
            done: false,
            type: 'herinnering',
            dueDate: date,
            dueTime: '12:00',
            klant: klantNaam,
            woning: adres,
            createdAt: new Date().toISOString()
          });
        }
      }

      if (data.datumVerkoopEigen) {
        const date = addDays(data.datumVerkoopEigen, -5);
        if (date) {
          newReminders.push({
            text: `Opvolging verkoop eigen woning (${formatDateToNL(data.datumVerkoopEigen)})`,
            done: false,
            type: 'herinnering',
            dueDate: date,
            dueTime: '12:00',
            klant: klantNaam,
            woning: adres,
            createdAt: new Date().toISOString()
          });
        }
      }

      if (data.datumWaarborgsom) {
        const date = addDays(data.datumWaarborgsom, -3);
        if (date) {
          newReminders.push({
            text: `Waarborgsom gestort?? (${formatDateToNL(data.datumWaarborgsom)})`,
            done: false,
            type: 'herinnering',
            dueDate: date,
            dueTime: '12:00',
            klant: klantNaam,
            woning: adres,
            createdAt: new Date().toISOString()
          });
        }
      }

      if (data.datumTransport) {
        const date = addDays(data.datumTransport, -7);
        if (date) {
          newReminders.push({
            text: `Concept leveringsakte ontvangen? (Transportdatum: ${formatDateToNL(data.datumTransport)})`,
            done: false,
            type: 'herinnering',
            dueDate: date,
            dueTime: '12:00',
            klant: klantNaam,
            woning: adres,
            createdAt: new Date().toISOString()
          });
        }
      }

      if (data.datumTransport) {
        const date = addDays(data.datumTransport, -5);
        if (date) {
          newReminders.push({
            text: `Concept leveringsakte besproken met aankoopklant (Transportdatum: ${formatDateToNL(data.datumTransport)})`,
            done: false,
            type: 'herinnering',
            dueDate: date,
            dueTime: '12:00',
            klant: klantNaam,
            woning: adres,
            createdAt: new Date().toISOString()
          });
        }
      }

      if (data.datumTransport) {
        const date = addDays(data.datumTransport, -5);
        if (date) {
          newReminders.push({
            text: `Nagaan of eindinspectie gepland is?? (Transportdatum: ${formatDateToNL(data.datumTransport)})`,
            done: false,
            type: 'herinnering',
            dueDate: date,
            dueTime: '12:00',
            klant: klantNaam,
            woning: adres,
            createdAt: new Date().toISOString()
          });
        }
      }

      // Courtagenota reminder (1 dag na ontbindende voorwaarden)
      let afloopOntbindendeVoorwaarden: string | null = null;
      if (data.datumFinanciering && data.datumBouwkundig) {
        afloopOntbindendeVoorwaarden = data.datumFinanciering > data.datumBouwkundig ? data.datumFinanciering : data.datumBouwkundig;
      } else if (data.datumFinanciering) {
        afloopOntbindendeVoorwaarden = data.datumFinanciering;
      } else if (data.datumBouwkundig) {
        afloopOntbindendeVoorwaarden = data.datumBouwkundig;
      }

      if (afloopOntbindendeVoorwaarden) {
        const date = addDays(afloopOntbindendeVoorwaarden, 1);
        if (date) {
          newReminders.push({
            text: `Courtagenota sturen naar klant (Afloop voorwaarden: ${formatDateToNL(afloopOntbindendeVoorwaarden)})`,
            done: false,
            type: 'herinnering',
            dueDate: date,
            dueTime: '12:00',
            klant: klantNaam,
            woning: adres,
            project: 'Administratie',
            createdAt: new Date().toISOString()
          });
        }
      }

      if (data.verkopendMakelaar) {
        newReminders.forEach(reminder => {
          reminder.text += ` - Makelaar: ${data.verkopendMakelaar}`;
        });
      }

      // 4. Batch-insert all new reminders
      const addPromises = newReminders.map(payload => addDoc(collection(db, 'tasks'), payload));
      await Promise.all(addPromises);
      console.log(`Successfully added ${newReminders.length} contract reminders for ${klantNaam}`);
      return newReminders;

    } catch (error) {
      console.error('Error in triggerContractReminders:', error);
      return [];
    }
  };

  const triggerBezichtigingReminders = async (
    klantNaam: string,
    adres: string,
    viewingDate: string,
    viewingTime: string
  ) => {
    try {
      if (!viewingDate) return [];
      
      const titles = [
        "Reactie klant [betreft bezichtiging]",
        "Terugkoppeling verkopend makelaar [betreft bezichtiging]"
      ];

      // 1. Delete existing automated reminders for this customer and property
      const q = query(
        collection(db, 'tasks'),
        where('klant', '==', klantNaam),
        where('woning', '==', adres)
      );
      const querySnapshot = await getDocs(q);
      const deletePromises: Promise<any>[] = [];
      querySnapshot.forEach((docSnap) => {
        const taskData = docSnap.data();
        const text = taskData.text || '';
        if (titles.some(title => text.startsWith(title))) {
          deletePromises.push(deleteDoc(doc(db, 'tasks', docSnap.id)));
        }
      });
      await Promise.all(deletePromises);

      // 2. Date arithmetic helper
      const addDays = (dateStr: string, days: number): string => {
        const parts = dateStr.split('-');
        if (parts.length !== 3) return '';
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        const d = new Date(year, month - 1, day);
        if (isNaN(d.getTime())) return '';
        d.setDate(d.getDate() + days);
        const yStr = d.getFullYear();
        const mStr = String(d.getMonth() + 1).padStart(2, '0');
        const dStr = String(d.getDate()).padStart(2, '0');
        return `${yStr}-${mStr}-${dStr}`;
      };

      const date3 = addDays(viewingDate, 3);
      const date4 = addDays(viewingDate, 4);
      const time = viewingTime || '12:00';

      const newTasks: any[] = [];
      if (date3) {
        newTasks.push({
          text: `Reactie klant [betreft bezichtiging] (Bezichtiging: ${formatDateToNL(viewingDate)})`,
          done: false,
          type: 'herinnering',
          dueDate: date3,
          dueTime: time,
          klant: klantNaam,
          woning: adres,
          createdAt: new Date().toISOString()
        });
      }
      if (date4) {
        newTasks.push({
          text: `Terugkoppeling verkopend makelaar [betreft bezichtiging] (Bezichtiging: ${formatDateToNL(viewingDate)})`,
          done: false,
          type: 'taak',
          dueDate: date4,
          dueTime: time,
          klant: klantNaam,
          woning: adres,
          createdAt: new Date().toISOString()
        });
      }

      const addPromises = newTasks.map(payload => addDoc(collection(db, 'tasks'), payload));
      await Promise.all(addPromises);
      console.log(`Successfully added ${newTasks.length} bezichtiging reminders for ${klantNaam}`);
      return newTasks;

    } catch (error) {
      console.error('Error in triggerBezichtigingReminders:', error);
      return [];
    }
  };



  const handleSaveAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionModal) return;

    if (actionModal.type === 'bieding') {
      if (!actionForm.datum || !actionForm.tijd) {
        alert('Vul een geldige datum en tijd in voor de deadline.');
        return;
      }
      const deadlineDateStr = `${actionForm.datum}T${actionForm.tijd}`;
      const deadline = new Date(deadlineDateStr);
      if (isNaN(deadline.getTime())) {
        alert('De ingevoerde datum of tijd voor de deadline is ongeldig.');
        return;
      }
    }

    try {
      const klantRef = doc(db, 'klanten', actionModal.klantId);
      
      const collectionName = 
        actionModal.type === 'bezichtiging' ? 'bezichtigingen' :
        actionModal.type === 'bieding' ? 'biedingen' :
        actionModal.type === 'keuring' ? 'keuringen' : 
        actionModal.type === 'interessante_woning' ? 'interessante_woningen' : 'koopcontracten';

      const klant = klantenLijst.find(k => k.id === actionModal.klantId);
      const existingArray = klant?.[collectionName] || [];

      const formToSave: any = {
        ...actionForm,
        bedrag: actionForm.prijs
      };

      // Handle Google Agenda webhooks for Koopovereenkomst
      const agendasAdded: string[] = [];
      if (actionModal.type === 'contract' && klant) {
        const webhookUrl = 'https://woonwensmakelaar.app.n8n.cloud/webhook/845898c5-28f9-4637-b1b1-5e5152965d2e';
        const klantNaam = klant.Naam || '';
        const adres = actionForm.adres || '';
        const voorwaarden = actionForm.voorwaarden || [];
        
        if (voorwaarden.includes('Financieringsvoorbehoud') && actionForm.datumFinanciering && !actionForm.webhookFinancieringSent) {
          fetch(webhookUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ titel: `Deadline Financieringsvoorbehoud - ${klantNaam} (${formatDateToDutchWords(actionForm.datumFinanciering)})`, datum: addDaysGlobal(actionForm.datumFinanciering, -7), tijd: '08:00', eindTijd: '09:00', klant: klantNaam, woning: adres })
          }).catch(e => console.error(e));
          formToSave.webhookFinancieringSent = true;
          agendasAdded.push('Financieringsvoorbehoud');
        }
        
        if (actionForm.datumTransport && !actionForm.webhookTransportSent) {
          fetch(webhookUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ titel: `Deadline Transport - ${klantNaam} (${formatDateToDutchWords(actionForm.datumTransport)})`, datum: addDaysGlobal(actionForm.datumTransport, -5), tijd: '08:00', eindTijd: '09:00', klant: klantNaam, woning: adres })
          }).catch(e => console.error(e));
          formToSave.webhookTransportSent = true;
          agendasAdded.push('Transportdatum');
        }

        if (actionForm.datumWaarborgsom && !actionForm.webhookWaarborgsomSent) {
          fetch(webhookUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ titel: `Deadline Waarborgsom - ${klantNaam} (${formatDateToDutchWords(actionForm.datumWaarborgsom)})`, datum: addDaysGlobal(actionForm.datumWaarborgsom, -3), tijd: '08:00', eindTijd: '09:00', klant: klantNaam, woning: adres })
          }).catch(e => console.error(e));
          formToSave.webhookWaarborgsomSent = true;
          agendasAdded.push('Waarborgsom');
        }
      }

      let updatedArray;
      let isStatusTransitionToGeweest = false;
      if (actionModal.actionId) {
        // Edit existing
        const previousItem = existingArray.find((item: any) => item.id === actionModal.actionId);
        if (actionModal.type === 'bezichtiging' && actionForm.status === 'geweest' && previousItem?.status !== 'geweest') {
          isStatusTransitionToGeweest = true;
        }
        updatedArray = existingArray.map((item: any) => 
          item.id === actionModal.actionId ? { ...item, ...formToSave } : item
        );
      } else {
        // Add new
        if (actionModal.type === 'bezichtiging' && actionForm.status === 'geweest') {
          isStatusTransitionToGeweest = true;
        }
        const newAction = {
          id: crypto.randomUUID(),
          ...formToSave,
          createdAt: new Date().toISOString()
        };
        updatedArray = [...existingArray, newAction];
      }

      await updateDoc(klantRef, {
        [collectionName]: updatedArray
      });

      setKlantenLijst(prev => prev.map(k => {
        if (k.id === actionModal.klantId) {
          return { ...k, [collectionName]: updatedArray };
        }
        return k;
      }));

      setActionModal(null);
      resetActionForm();

      // Trigger automatic tasks if status transitioned to 'geweest'
      if (actionModal.type === 'bezichtiging' && klant) {
        const datum = actionForm.datum || '';
        const tijd = actionForm.tijd || '12:00';
        
        if (datum) {
          const addedReminders = await triggerBezichtigingReminders(
            klant.Naam || '',
            actionForm.adres || '',
            datum,
            tijd
          );
          if (addedReminders && addedReminders.length > 0) {
            const reminderListStr = addedReminders.map((r: any) => {
              let displayTxt = r.text;
              if (r.woning && displayTxt.includes('[betreft bezichtiging]')) {
                displayTxt = displayTxt.replace('[betreft bezichtiging]', r.woning);
              }
              return `• [${formatDateToNL(r.dueDate)}] ${displayTxt}`;
            }).join('\n');
            alert(`Bezichtiging succesvol opgeslagen!\n\nDe volgende herinneringen en taken zijn toegevoegd/bijgewerkt in je dashboard Takenlijst:\n\n${reminderListStr}`);
          }
        } else {
          alert('Bezichtiging succesvol opgeslagen!');
        }
      } else if (actionModal.type === 'bieding' && klant) {
        const klantNaam = klant.Naam || '';
        const adres = actionForm.adres || '';
        
        let agendaAdded = false;
        let reminder1Text = '';
        let reminder1Date = '';
        let reminder1Time = '';
        let detailedMsg = '';
        let oneDayAfterStr = '';

        const deadlineDateStr = `${actionForm.datum}T${actionForm.tijd}`;
        const deadline = new Date(deadlineDateStr);
        if (!isNaN(deadline.getTime())) {
          const oneHourBefore = new Date(deadline.getTime() - 60 * 60 * 1000);
          const dueDate = oneHourBefore.toISOString().split('T')[0];
          const dueTime = oneHourBefore.toTimeString().split(' ')[0].substring(0, 5);

          const makelaarText = actionForm.verkopendMakelaar ? ` - Makelaar: ${actionForm.verkopendMakelaar}` : '';
          const reminderTextWithDeadline = `Bieding deadline herinnering - ${klantNaam} (Deadline: ${formatDateToNL(actionForm.datum)} om ${actionForm.tijd} uur)${makelaarText}`;

          const reminder1Payload = {
            text: reminderTextWithDeadline,
            done: false,
            type: 'herinnering',
            dueDate: dueDate,
            dueTime: dueTime,
            klant: klantNaam,
            woning: adres,
            createdAt: new Date().toISOString()
          };

          await addDoc(collection(db, 'tasks'), reminder1Payload);
          
          reminder1Text = reminderTextWithDeadline;
          reminder1Date = dueDate;
          reminder1Time = dueTime;

          // n8n Webhook POST-request
          const webhookPayload = {
            titel: `Bieding deadline - ${klantNaam} (${actionForm.tijd} uur)`,
            datum: actionForm.datum,
            tijd: calculateOneHourBefore(actionForm.tijd),
            eindTijd: actionForm.tijd,
            klant: klantNaam,
            woning: adres
          };
          agendaAdded = true;

          fetch('https://woonwensmakelaar.app.n8n.cloud/webhook/845898c5-28f9-4637-b1b1-5e5152965d2e', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhookPayload)
          }).catch(err => console.error('n8n Webhook error:', err));
        }

        // 2. Herinnering 1 dag na het uitbrengen van het bod (dus 1 dag na de deadline)
        if (actionForm.datum) {
          const parts = actionForm.datum.split('-');
          if (parts.length === 3) {
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10);
            const day = parseInt(parts[2], 10);
            const d = new Date(year, month - 1, day);
            if (!isNaN(d.getTime())) {
              d.setDate(d.getDate() + 1);
              const yStr = d.getFullYear();
              const mStr = String(d.getMonth() + 1).padStart(2, '0');
              const dStr = String(d.getDate()).padStart(2, '0');
              oneDayAfterStr = `${yStr}-${mStr}-${dStr}`;
            }
          }
        }

        // Fallback if deadline date is invalid
        if (!oneDayAfterStr) {
          const oneDayAfter = new Date();
          oneDayAfter.setDate(oneDayAfter.getDate() + 1);
          oneDayAfterStr = oneDayAfter.toISOString().split('T')[0];
        }

        const makelaarText2 = actionForm.verkopendMakelaar ? ` - Makelaar: ${actionForm.verkopendMakelaar}` : '';
        const reminder2Payload = {
          text: `Terugkoppeling ontvangen verkopend makelaar op het gedane bod (Deadline: ${formatDateToNL(actionForm.datum)} om ${actionForm.tijd} uur)${makelaarText2}`,
          done: false,
          type: 'herinnering',
          dueDate: oneDayAfterStr,
          dueTime: '12:00',
          klant: klantNaam,
          woning: adres,
          createdAt: new Date().toISOString()
        };

        await addDoc(collection(db, 'tasks'), reminder2Payload);

        // Build a detailed message listing exactly what was added
        detailedMsg = `Bieding succesvol opgeslagen!\n\nDe volgende herinneringen en taken zijn toegevoegd aan je dashboard Takenlijst:\n`;
        if (reminder1Text) {
          detailedMsg += `• [${formatDateToNL(reminder1Date)}] (Om ${reminder1Time} uur): ${reminder1Text}\n`;
        }
        detailedMsg += `• [${formatDateToNL(oneDayAfterStr)}] (Om 12:00 uur): Terugkoppeling ontvangen verkopend makelaar op het gedane bod (Deadline: ${formatDateToNL(actionForm.datum)} om ${actionForm.tijd} uur)\n`;

        if (agendaAdded) {
          detailedMsg += `\nEn toegevoegd aan je Google Agenda:\n`;
          detailedMsg += `• [${formatDateToNL(actionForm.datum)}] (Om ${calculateOneHourBefore(actionForm.tijd)} uur): Bieding deadline - ${klantNaam} (${actionForm.tijd} uur)\n`;
        }

        alert(detailedMsg);
      } else if (actionModal.type === 'contract' && klant) {
        const addedReminders = await triggerContractReminders(klant.Naam || '', actionForm.adres || '', actionForm);
        let msg = `Koopovereenkomst succesvol opgeslagen!`;
        if (addedReminders && addedReminders.length > 0) {
          const reminderListStr = addedReminders.map((r: any) => `• [${formatDateToNL(r.dueDate)}] ${r.text}`).join('\n');
          msg += `\n\nDe volgende herinneringen zijn bijgewerkt in je Takenlijst:\n\n${reminderListStr}`;
        }
        if (agendasAdded && agendasAdded.length > 0) {
          msg += `\n\nDe volgende afspraken zijn toegevoegd aan je Google Agenda:\n- ${agendasAdded.join('\n- ')}`;
        }
        alert(msg);
      } else {
        alert('Succesvol toegevoegd!');
      }
    } catch (err) {
      console.error('Error saving action:', err);
      alert('Fout bij opslaan in Firebase.');
    }
  };

  const handleDeleteAction = async () => {
    if (!actionModal || !actionModal.actionId) return;

    if (!window.confirm('Weet je zeker dat je dit item wilt verwijderen?')) return;

    try {
      const klantRef = doc(db, 'klanten', actionModal.klantId);
      
      const collectionName = 
        actionModal.type === 'bezichtiging' ? 'bezichtigingen' :
        actionModal.type === 'bieding' ? 'biedingen' :
        actionModal.type === 'keuring' ? 'keuringen' : 
        actionModal.type === 'interessante_woning' ? 'interessante_woningen' : 'koopcontracten';

      const klant = klantenLijst.find(k => k.id === actionModal.klantId);
      const existingArray = klant?.[collectionName] || [];

      // Filter out the item to delete
      const updatedArray = existingArray.filter((item: any) => item.id !== actionModal.actionId);

      await updateDoc(klantRef, {
        [collectionName]: updatedArray
      });

      setKlantenLijst(prev => prev.map(k => {
        if (k.id === actionModal.klantId) {
          return { ...k, [collectionName]: updatedArray };
        }
        return k;
      }));

      setActionModal(null);
      resetActionForm();
      alert('Succesvol verwijderd!');
    } catch (err) {
      console.error('Error deleting action:', err);
      alert('Fout bij verwijderen in Firebase.');
    }
  };

  const handleUpdateBiedingStatus = async (klantId: string, biedingId: string, newStatus: string, e?: React.MouseEvent | React.ChangeEvent) => {
    if (e) {
      e.stopPropagation();
    }
    try {
      const klantRef = doc(db, 'klanten', klantId);
      const klant = klantenLijst.find(k => k.id === klantId);
      if (!klant) return;
      const updatedArray = klant.biedingen.map((b: any) => 
        b.id === biedingId ? { ...b, status: newStatus } : b
      );

      await updateDoc(klantRef, { biedingen: updatedArray });

      setKlantenLijst(prev => prev.map(k => {
        if (k.id === klantId) {
          return { ...k, biedingen: updatedArray };
        }
        return k;
      }));
    } catch (err) {
      console.error('Error updating bieding status:', err);
      alert('Fout bij updaten status in Firebase.');
    }
  };

  const handleMoveToNextRow = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!actionModal || !actionModal.actionId) return;

    // Capture the modal values and close it synchronously to prevent parallel executions / double submissions!
    const { klantId, actionId, type: modalType } = actionModal;
    setActionModal(null);

    try {
      const klantRef = doc(db, 'klanten', klantId);
      const klant = klantenLijst.find(k => k.id === klantId);
      if (!klant) return;

      const currentCollection = 
        modalType === 'interessante_woning' ? 'interessante_woningen' :
        modalType === 'bezichtiging' ? 'bezichtigingen' :
        modalType === 'bieding' ? 'biedingen' :
        modalType === 'keuring' ? 'keuringen' : 'koopcontracten';

      const nextType = (
        modalType === 'interessante_woning' ? 'bezichtiging' :
        modalType === 'bezichtiging' ? 'bieding' :
        modalType === 'bieding' ? 'contract' :
        modalType === 'keuring' ? 'contract' : null
      ) as string | null;

      if (!nextType) {
        alert('Dit item kan niet verder naar de volgende rij verplaatst worden.');
        return;
      }

      const nextCollection = 
        nextType === 'bezichtiging' ? 'bezichtigingen' :
        nextType === 'bieding' ? 'biedingen' :
        nextType === 'keuring' ? 'keuringen' : 'koopcontracten';

      const currentArray = klant[currentCollection] || [];
      const itemToMove = currentArray.find((item: any) => item.id === actionId);
      if (!itemToMove) return;

      const formToSave = {
        ...actionForm,
        bedrag: actionForm.prijs
      };

      const updatedCurrentArray = currentArray.map((item: any) => 
        item.id === actionId ? { ...item, ...formToSave } : item
      );

      if (nextType === 'contract') {
        const todayStr = new Date().toISOString().split('T')[0];
        formToSave.datumInvoer = todayStr;
        formToSave.koopsom = itemToMove.prijs || itemToMove.bedrag || '';
        formToSave.notariskeuze = itemToMove.notarisBieding || '';
        formToSave.voorwaarden = itemToMove.voorwaarden || [];
        formToSave.bedragFinanciering = itemToMove.bedragFinanciering || '';
      }
      
      const newItem = {
        ...itemToMove,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString()
      };
      
      Object.assign(newItem, formToSave);
      
      if (nextType === 'bezichtiging' || nextType === 'bieding') {
        newItem.status = 'gepland';
      }

      const nextArray = klant[nextCollection] || [];
      const updatedNextArray = [...nextArray, newItem];

      await updateDoc(klantRef, {
        [currentCollection]: updatedCurrentArray,
        [nextCollection]: updatedNextArray
      });

      const {
        interessante_woningen,
        bezichtigingen,
        biedingen,
        keuringen,
        koopcontracten,
        ...klantProfielData
      } = klant as any;

      const webhookPayload = {
        event: 'item_moved_to_next_row',
        klantId: klant.id,
        klantNaam: (klant as any).Naam || klant.name || '',
        profiel: klantProfielData,
        fromStage: currentCollection,
        toStage: nextCollection,
        item: newItem,
        timestamp: new Date().toISOString()
      };

      try {
        await fetch('https://woonwensmakelaar.app.n8n.cloud/webhook/845898c5-28f9-4637-b1b1-5e5152965d2e', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload)
        });
        console.log('Webhook verstuurd naar n8n voor:', newItem.adres);
      } catch (webhookErr) {
        console.error('Error sending webhook to n8n:', webhookErr);
      }

      setKlantenLijst(prev => prev.map(k => {
        if (k.id === klantId) {
          return { ...k, [currentCollection]: updatedCurrentArray, [nextCollection]: updatedNextArray };
        }
        return k;
      }));

      // Automatically open the edit action modal for the new column phase!
      openEditActionModal(nextType as any, klant, newItem);
    } catch (err) {
      console.error('Error moving action:', err);
      alert('Fout bij verplaatsen in Firebase.');
    }
  };

  const handleAddInteressanteWoningFromMatch = async (klantId: string, address: string) => {
    try {
      const klantRef = doc(db, 'klanten', klantId);
      const klant = klantenLijst.find(k => k.id === klantId);
      if (!klant) return;
      
      const newAction = {
        id: crypto.randomUUID(),
        adres: address,
        notities: 'Toegevoegd via automatische match',
        createdAt: new Date().toISOString()
      };
      
      const existingArray = klant.interessante_woningen || [];
      
      await updateDoc(klantRef, {
        interessante_woningen: [...existingArray, newAction]
      });
      
      setKlantenLijst(prev => prev.map(k => k.id === klantId ? { ...k, interessante_woningen: [...existingArray, newAction] } : k));
    } catch (e) {
      console.error(e);
      alert('Fout bij toevoegen interessante woning vanuit match.');
    }
  };

  const refreshKlanten = async () => {
    setRefreshingKlanten(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'klanten'));
      const fetchedKlanten = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setKlantenLijst(fetchedKlanten);
    } catch (e) {
      console.error('Fout bij ophalen Firebase klanten:', e);
      alert('Fout bij ophalen klanten profielen van Firebase.');
    } finally {
      setRefreshingKlanten(false);
    }
  };

  const handleDeleteKlant = async (id: string, name: string) => {
    if (!window.confirm(`Weet je zeker dat je het profiel van "${name}" wilt verwijderen?`)) return;
    
    setDeletingKlantId(id);
    try {
      await deleteDoc(doc(db, 'klanten', id));
      setKlantenLijst(prev => prev.filter(k => k.id !== id));
      alert(`Profiel van ${name} succesvol verwijderd.`);
    } catch (err) {
      console.error('Delete error:', err);
      alert('Fout bij verwijderen in Firebase.');
    } finally {
      setDeletingKlantId(null);
    }
  };

  const resetAddKlantForm = () => {
    setAddKlantStep(1);
    setLocatieError(false);
    setShowSpecifiekeWensen(false);
    setNewKlant({
      Naam: '', Regio: '', BijzonderhedenRegio: '',
      GeselecteerdeLocaties: [], GeselecteerdeCoords: {}, LocatieZoekterm: '', LocatieFilter: 'Alles',
      Soort: 'koop', Prijsklasse: '', PrijsMax: '', Bouwvorm: 'beide',
      Objectsoort: 'woonhuis_appartement', Woonoppervlakte: '', Perceeloppervlakte: '',
      AantalKamers: '', AantalSlaapkamers: '', Bestemming: ['permanente_bewoning'],
      DubbeleBewoning: [], Energielabel: '', Buitenruimte: [],
      TypeWoning: [], SoortWoning: [], SoortAppartement: [], Ligging: [],
      Bijzonderheden: [], Toegankelijkheid: [], OnderhoudBinnen: '', OnderhoudBuiten: '',
      Parkeren: [], Voorzieningen: [], Eigendom: [],
      BouwjaarVan: '', BouwjaarTm: '', MinMatchPercentage: '80', Prioriteiten: [],
      Email: '', Notificatie: 'direct', Notities: '', BijzondereKenmerken: '', Woningtype: '',
      StuurtEigenAanbod: true, AanbodVanaf: 'Afgelopen 2 weken', Status: 'actief',
    });
  };

  const handleAddKlant = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingKlant(true);
    try {
      const payload = {
        Naam: newKlant.Naam,
        Regio: newKlant.GeselecteerdeLocaties.length > 0 ? newKlant.GeselecteerdeLocaties.join(', ') : newKlant.Regio,
        BijzonderhedenRegio: newKlant.BijzonderhedenRegio,
        Prijsklasse: (newKlant.Prijsklasse || newKlant.PrijsMax)
          ? `€ ${newKlant.Prijsklasse || 0} – € ${newKlant.PrijsMax || newKlant.Prijsklasse}`
          : '',
        // Samenvatting van alle specifieke kenmerken (voor AI-matching)
        SpecifiekeKenmerken: [
          ...newKlant.Ligging, ...newKlant.Bijzonderheden, ...newKlant.Toegankelijkheid,
          ...newKlant.Buitenruimte, ...newKlant.Parkeren, ...newKlant.Voorzieningen, ...newKlant.Eigendom,
          newKlant.OnderhoudBinnen ? `Onderhoud binnen: ${newKlant.OnderhoudBinnen}` : '',
          newKlant.OnderhoudBuiten ? `Onderhoud buiten: ${newKlant.OnderhoudBuiten}` : '',
          newKlant.BouwjaarVan ? `Bouwjaar v.a. ${newKlant.BouwjaarVan}` : '',
          newKlant.BouwjaarTm ? `t/m ${newKlant.BouwjaarTm}` : '',
          newKlant.AantalKamers ? `Min. ${newKlant.AantalKamers} kamers` : '',
          newKlant.AantalSlaapkamers ? `Min. ${newKlant.AantalSlaapkamers} slaapkamers` : '',
        ].filter(Boolean).join(', '),
        // Individuele velden opslaan zodat bewerken altijd correct werkt
        Woningtype: [...newKlant.TypeWoning, ...newKlant.SoortWoning, ...newKlant.SoortAppartement].join(', ') || newKlant.Objectsoort,
        TypeWoning: newKlant.TypeWoning,
        SoortWoning: newKlant.SoortWoning,
        SoortAppartement: newKlant.SoortAppartement,
        Ligging: newKlant.Ligging,
        Bijzonderheden: newKlant.Bijzonderheden,
        Toegankelijkheid: newKlant.Toegankelijkheid,
        Parkeren: newKlant.Parkeren,
        Voorzieningen: newKlant.Voorzieningen,
        Eigendom: newKlant.Eigendom,
        OnderhoudBinnen: newKlant.OnderhoudBinnen,
        OnderhoudBuiten: newKlant.OnderhoudBuiten,
        BouwjaarVan: newKlant.BouwjaarVan,
        BouwjaarTm: newKlant.BouwjaarTm,
        Soort: newKlant.Soort,
        Bouwvorm: newKlant.Bouwvorm,
        Objectsoort: newKlant.Objectsoort,
        Woonoppervlakte: newKlant.Woonoppervlakte,
        Perceeloppervlakte: newKlant.Perceeloppervlakte,
        AantalKamers: newKlant.AantalKamers,
        AantalSlaapkamers: newKlant.AantalSlaapkamers,
        Bestemming: newKlant.Bestemming,
        DubbeleBewoning: newKlant.DubbeleBewoning,
        Energielabel: newKlant.Energielabel,
        MinMatchPercentage: parseInt(newKlant.MinMatchPercentage.replace('%', ''), 10),
        Prioriteiten: newKlant.Prioriteiten,
        Buitenruimte: newKlant.Buitenruimte,
        Email: newKlant.Email,
        Notificatie: newKlant.Notificatie,
        Notities: newKlant.Notities,
        BijzondereKenmerken: newKlant.BijzondereKenmerken,
        Status: newKlant.Status,
        StuurtEigenAanbod: newKlant.StuurtEigenAanbod,
        AanbodVanaf: newKlant.AanbodVanaf,
      };

      try {
        if (editingKlantId) {
          await updateDoc(doc(db, 'klanten', editingKlantId), payload);
          alert('Profiel succesvol bijgewerkt!');
        } else {
          await addDoc(collection(db, 'klanten'), { ...payload, createdAt: new Date().toISOString() });
          alert('Klant succesvol opgeslagen in Firebase!');
        }
        setShowAddKlantModal(false);
        resetAddKlantForm();
        setEditingKlantId(null);
        refreshKlanten();
      } catch (fbErr) {
        console.error("Fout bij opslaan in Firebase:", fbErr);
        alert('Fout bij verbinding met Firebase Database.');
      }
    } catch (e) {
      alert('Fout bij ophalen van data payload.');
    } finally {
      setSubmittingKlant(false);
    }
  };

  const handleEditKlant = (klant: any) => {
    // Parseren van bestaande data
    let prijsVan = '';
    let prijsTot = '';
    if (klant.Prijsklasse) {
      const parts = klant.Prijsklasse.replace(/€/g, '').split(/[–-]/);
      if (parts.length >= 2) {
        prijsVan = parts[0].trim().replace(/\./g, '');
        prijsTot = parts[1].trim().replace(/\./g, '');
      } else {
        prijsVan = parts[0].trim().replace(/\./g, '');
      }
    }

    // Helper: zet string of array veld altijd om naar array
    const toArray = (val: any): string[] => {
      if (Array.isArray(val)) return val;
      if (typeof val === 'string' && val.trim()) return val.split(',').map((s: string) => s.trim());
      return [];
    };

    setNewKlant({
      ...newKlant,
      Naam: klant.Naam || '',
      Regio: klant.Regio || '',
      BijzonderhedenRegio: klant.BijzonderhedenRegio || klant['Bijzonderheden Regio'] || '',
      Prijsklasse: prijsVan,
      PrijsMax: prijsTot,
      Objectsoort: klant.Objectsoort || 'woonhuis_appartement',
      Soort: klant.Soort?.toLowerCase() || 'koop',
      Bouwvorm: klant.Bouwvorm?.toLowerCase() || 'beide',
      Woonoppervlakte: klant.Woonoppervlakte || '',
      Perceeloppervlakte: klant.Perceeloppervlakte || '',
      AantalKamers: klant.AantalKamers || '',
      AantalSlaapkamers: klant.AantalSlaapkamers || '',
      Energielabel: klant.Energielabel || '',
      Email: klant.Email || '',
      Notificatie: klant.Notificatie || 'direct',
      MinMatchPercentage: klant.MinMatchPercentage ? String(klant.MinMatchPercentage).replace('%', '') : '80',
      GeselecteerdeLocaties: klant.Regio ? klant.Regio.split(',').map((s: string) => s.trim()) : [],
      // Bug fix: herstel alle array-velden zodat checkboxes correct tonen bij bewerken
      Bestemming: toArray(klant.Bestemming).length > 0 ? toArray(klant.Bestemming) : ['permanente_bewoning'],
      DubbeleBewoning: toArray(klant.DubbeleBewoning),
      Buitenruimte: toArray(klant.Buitenruimte),
      TypeWoning: toArray(klant.TypeWoning),
      SoortWoning: toArray(klant.SoortWoning),
      SoortAppartement: toArray(klant.SoortAppartement),
      Ligging: toArray(klant.Ligging),
      Bijzonderheden: toArray(klant.Bijzonderheden),
      Toegankelijkheid: toArray(klant.Toegankelijkheid),
      Parkeren: toArray(klant.Parkeren),
      Voorzieningen: toArray(klant.Voorzieningen),
      Eigendom: toArray(klant.Eigendom),
      Prioriteiten: toArray(klant.Prioriteiten),
      OnderhoudBinnen: klant.OnderhoudBinnen || '',
      OnderhoudBuiten: klant.OnderhoudBuiten || '',
      BouwjaarVan: klant.BouwjaarVan || '',
      BouwjaarTm: klant.BouwjaarTm || '',
      Notities: klant.Notities || '',
      BijzondereKenmerken: klant.BijzondereKenmerken || '',
      Status: klant.Status || 'actief',
      StuurtEigenAanbod: klant.StuurtEigenAanbod ?? true,
      AanbodVanaf: klant.AanbodVanaf || 'Afgelopen 2 weken',
    });

    setEditingKlantId(klant.id);
    setAddKlantStep(1);
    setShowAddKlantModal(true);
  };

  const refreshScans = async () => {
    setRefreshingScans(true);
    try {
      const directScans = await fetchScansDirectlyFromFirestore();
      if (directScans && directScans.length > 0) {
        setScanRuns(directScans);
        setCurrentNieuwsteRunIndex(0);
        setCurrentVorigeRunIndex(directScans.length > 1 ? 1 : 0);
        alert(`Succesvol ${directScans.length} scraper-runs ververst uit Firestore!`);
      } else {
        alert('Geen scraper-runs gevonden in Firestore.');
      }
    } catch (error) {
      console.error('Error refreshing scans:', error);
      alert('Fout bij verversen scans via Firestore.');
    } finally {
      setRefreshingScans(false);
    }
  };

  const SidebarIcon = ({ view, icon: Icon, label }: { view: View, icon: any, label: string }) => (
    <button
      onClick={() => setActiveView(view)}
      title={label}
      className={`p-3 rounded-lg transition-all duration-200 relative group ${activeView === view
          ? 'bg-[#34495e] text-[#e74c3c]'
          : view === 'stable'
            ? 'text-red-500 hover:bg-slate-800'
            : 'text-[#4db6ac] hover:bg-slate-800'
        }`}
    >
      <Icon 
        size={32} 
        strokeWidth={1.5} 
        className={view === 'stable' ? 'fill-red-500 text-red-500 animate-pulse' : ''} 
      />
      {activeView === view && (
        <div className="absolute left-[-12px] top-0 bottom-0 w-1.5 bg-[#e74c3c] rounded-r-full" />
      )}
      {/* Tooltip on hover */}
      <div className="absolute left-full ml-4 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
        {label}
      </div>
    </button>
  );

  // Bottom navigation item for mobile
  const BottomNavItem = ({ view, icon: Icon, label }: { view: View, icon: any, label: string }) => (
    <button
      onClick={() => setActiveView(view)}
      className={`flex flex-col items-center justify-center flex-1 py-2 gap-1 transition-all duration-200 ${
        activeView === view ? 'text-[#e74c3c]' : 'text-[#4db6ac]'
      }`}
    >
      <Icon size={22} strokeWidth={1.5} />
      <span className="text-[9px] font-bold uppercase tracking-wider leading-none">{label}</span>
    </button>
  );

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#141e2b]">
        <Loader2 size={40} className="animate-spin text-[#e67e22]" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar – desktop only */}
      <aside className="hidden md:flex w-20 flex-col items-center py-8 bg-[#141e2b] gap-8 border-r border-slate-800">
        <SidebarIcon view="nieuwste" icon={Home} label="Nieuwste huizen" />

        <SidebarIcon view="matches" icon={MatchIcon} label="Matches" />
        <SidebarIcon view="manager" icon={ClipboardList} label="Manager" />
        <SidebarIcon view="klanten" icon={UserPlus} label="Klanten Profielen" />
        <SidebarIcon view="blog-post-maker" icon={PenTool} label="Blog Post Maker" />
        <SidebarIcon view="database" icon={Database} label="Database" />
        <SidebarIcon view="tasks" icon={CheckSquare} label="Takenlijst" />
        <SidebarIcon view="stable" icon={Heart} label="Stabiele Versie" />
        
        <div className="mt-auto mb-4">
          <button
            onClick={() => signOut(auth)}
            title="Uitloggen"
            className="p-3 rounded-lg transition-all duration-200 relative group text-slate-500 hover:text-red-400 hover:bg-slate-800"
          >
            <LogIn size={28} className="rotate-180" strokeWidth={1.5} />
            <div className="absolute left-full ml-4 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
              Uitloggen
            </div>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex flex-col items-center justify-center py-3 bg-white/40 backdrop-blur-md border-b border-slate-100">
          <h1 className="text-base sm:text-lg font-bold flex items-center tracking-tight">
            <span className="text-[#e67e22]">W</span>
            <span className="text-[#2d3e50]">oon</span>
            <span className="text-[#e74c3c]">W</span>
            <span className="text-[#2d3e50]">ens</span>
            <span className="text-[#2d3e50] ml-1.5">Client</span>
            <span className="text-[#d3b8ae] ml-1.5">M</span>
            <span className="text-[#2d3e50]">anagement</span>
          </h1>
        </header>

        {/* Content Area – bottom padding on mobile for bottom nav */}
        <div className="flex-1 overflow-auto px-4 sm:px-6 lg:px-12 py-4 pb-24 md:pb-4">
          <div className="w-full max-w-[1920px] mx-auto">
            <AnimatePresence mode="wait">
              {activeView === 'manager' ? (
                <motion.div
                  key="manager"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <h2 className="text-3xl font-bold text-[#2d3e50]">
                      Klantoverzicht - <span className="text-[#2d3e50]">Aankooptraject</span>
                    </h2>
                    <div className="relative w-full sm:w-72">
                      <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
                      <input 
                        type="text" 
                        placeholder="Zoek klantnaam..." 
                        value={klantSearchTerm}
                        onChange={(e) => setKlantSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all bg-white shadow-sm"
                      />
                    </div>
                  </div>

                  {klantenLijst.length === 0 ? (
                    <div className="glass-card p-16 text-center text-slate-400">
                      <Users size={48} className="mx-auto mb-4 text-slate-300" />
                      <p className="font-semibold text-lg">Geen klanten gevonden</p>
                      <p className="text-sm mt-1">Ga naar Klanten Profielen en verversen de data om klanten te laden.</p>
                    </div>
                  ) : (
                  <div className="glass-card overflow-auto max-h-[calc(100vh-240px)] md:max-h-[calc(100vh-190px)] border border-slate-300 custom-scrollbar">
                    <table className="w-full text-left border-collapse min-w-[1200px]">
                      <thead>
                        <tr className="table-header">
                          <th className="sticky top-0 z-10 bg-[#f3f4f6] px-6 py-4 border-b border-slate-300">Klant</th>
                          <th className="sticky top-0 z-10 bg-[#f3f4f6] px-4 py-4 border-b border-l border-slate-300 min-w-[180px] max-w-[220px]">Interessante woningen</th>
                          <th className="sticky top-0 z-10 bg-[#f3f4f6] px-6 py-4 border-b border-l border-slate-300">Bezichtigingen</th>
                          <th className="sticky top-0 z-10 bg-[#f3f4f6] px-6 py-4 border-b border-l border-slate-300">Biedingen</th>
                          <th className="sticky top-0 z-10 bg-[#f3f4f6] px-6 py-4 border-b border-l border-slate-300 text-center">Koopovereenkomst</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-300">
                        {sortedKlantenLijst.map((klant, idx) => (
                          <tr key={idx} className="bg-white/40 hover:bg-white/60 transition-colors">

                            {/* Klant Column */}
                            <td className="px-6 py-5 align-top min-w-[320px]">
                              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-col gap-3">
                                {/* Avatar + naam + email */}
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#e67e22] to-orange-400 flex items-center justify-center text-white font-bold text-base shadow-sm flex-shrink-0">
                                    {klant.Naam ? klant.Naam.charAt(0).toUpperCase() : '?'}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-bold text-[#2d3e50] text-base leading-tight">{klant.Naam || 'Naamloos'}</p>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {(() => {
                                        const s = (klant.Status || 'actief').toLowerCase();
                                        if (s === 'prospect') {
                                          return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold ring-1 ring-inset ring-blue-600/30">Prospect</span>;
                                        } else if (s === 'inactief') {
                                          return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-200 text-slate-800 text-[10px] font-bold ring-1 ring-inset ring-slate-600/30">Inactief</span>;
                                        } else if (s === 'aangekocht') {
                                          return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold ring-1 ring-inset ring-amber-600/30">Aangekocht</span>;
                                        }
                                        return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold ring-1 ring-inset ring-emerald-600/30">Actief</span>;
                                      })()}
                                      {klant.Notificatie && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-semibold ring-1 ring-inset ring-blue-200 capitalize">{klant.Notificatie}</span>
                                      )}
                                    </div>
                                    {klant.Email && <p className="text-[10px] text-slate-400 truncate mt-0.5">{klant.Email}</p>}
                                  </div>
                                </div>

                                {/* Divider */}
                                <div className="border-t border-slate-100" />

                                {/* 📍 Locatie */}
                                <div>
                                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">📍 Locatie</p>
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-xs">
                                      <span className="text-slate-500">Regio</span>
                                      <span className="font-medium text-slate-700 text-right max-w-[170px] leading-snug">{klant.Regio || '—'}</span>
                                    </div>
                                    {klant.BijzonderhedenRegio && (
                                      <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Bijzonderheden</span>
                                        <span className="font-medium text-slate-700 text-right max-w-[170px] leading-snug">{klant.BijzonderhedenRegio}</span>
                                      </div>
                                    )}
                                    {klant.AanbodVanaf && (
                                      <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Aanbod vanaf</span>
                                        <span className="font-medium text-slate-700">{klant.AanbodVanaf}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* 💰 Financieel */}
                                <div>
                                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">💰 Financieel</p>
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-xs">
                                      <span className="text-slate-500">Soort</span>
                                      <span className="font-medium text-slate-700 capitalize">{klant.Soort || '—'}</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                      <span className="text-slate-500">Budget</span>
                                      <span className="font-medium text-slate-700">{klant.Prijsklasse || '—'}</span>
                                    </div>
                                    {klant.MinMatchPercentage !== undefined && klant.MinMatchPercentage !== '' && (
                                      <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Min. match</span>
                                        <span className="font-medium text-slate-700">{klant.MinMatchPercentage}%</span>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* 🏠 Woning */}
                                <div>
                                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">🏠 Woning</p>
                                  <div className="space-y-1">
                                    {klant.Woningtype && (
                                      <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Type</span>
                                        <span className="font-medium text-slate-700 text-right max-w-[170px] leading-snug">{klant.Woningtype}</span>
                                      </div>
                                    )}
                                    {klant.Objectsoort && (
                                      <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Objectsoort</span>
                                        <span className="font-medium text-slate-700 capitalize">{klant.Objectsoort?.replace(/_/g, ' / ')}</span>
                                      </div>
                                    )}
                                    {klant.Bouwvorm && (
                                      <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Bouwvorm</span>
                                        <span className="font-medium text-slate-700 capitalize">{klant.Bouwvorm}</span>
                                      </div>
                                    )}
                                    {klant.Energielabel && (
                                      <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Energielabel</span>
                                        <span className="font-bold text-emerald-600">{klant.Energielabel}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* 📐 Afmetingen & kamers */}
                                {(klant.Woonoppervlakte || klant.Perceeloppervlakte || klant.AantalKamers || klant.AantalSlaapkamers) && (
                                  <div>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">📐 Afmetingen</p>
                                    <div className="space-y-1">
                                      {klant.Woonoppervlakte && (
                                        <div className="flex justify-between text-xs">
                                          <span className="text-slate-500">Woonopp. min.</span>
                                          <span className="font-medium text-slate-700">{klant.Woonoppervlakte} m²</span>
                                        </div>
                                      )}
                                      {klant.Perceeloppervlakte && (
                                        <div className="flex justify-between text-xs">
                                          <span className="text-slate-500">Percelopp. min.</span>
                                          <span className="font-medium text-slate-700">{klant.Perceeloppervlakte} m²</span>
                                        </div>
                                      )}
                                      {klant.AantalKamers && (
                                        <div className="flex justify-between text-xs">
                                          <span className="text-slate-500">Min. kamers</span>
                                          <span className="font-medium text-slate-700">{klant.AantalKamers}</span>
                                        </div>
                                      )}
                                      {klant.AantalSlaapkamers && (
                                        <div className="flex justify-between text-xs">
                                          <span className="text-slate-500">Min. slaapkamers</span>
                                          <span className="font-medium text-slate-700">{klant.AantalSlaapkamers}</span>
                                        </div>
                                      )}
                                      {(klant.BouwjaarVan || klant.BouwjaarTm) && (
                                        <div className="flex justify-between text-xs">
                                          <span className="text-slate-500">Bouwjaar</span>
                                          <span className="font-medium text-slate-700">{klant.BouwjaarVan || '?'} – {klant.BouwjaarTm || '?'}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* ✨ Specifieke kenmerken als tags */}
                                {klant.SpecifiekeKenmerken && (
                                  <div>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">✨ Kenmerken</p>
                                    <div className="flex flex-wrap gap-1">
                                      {klant.SpecifiekeKenmerken.split(',').map((k: string, i: number) => k.trim() && (
                                        <span key={i} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] rounded">{k.trim()}</span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* 📝 Notities */}
                                {klant.Notities && (
                                  <div>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">📝 Notities</p>
                                    <p className="text-xs text-slate-600 italic">"{klant.Notities}"</p>
                                  </div>
                                )}

                                {/* ⚠️ Essentieel */}
                                {klant.BijzondereKenmerken && (
                                  <div className="mt-2">
                                    <p className="text-[9px] font-bold text-rose-500 uppercase tracking-widest mb-1.5">⚠️ Essentieel</p>
                                    <div className="bg-rose-50 border border-rose-100 rounded-md p-2">
                                      <p className="text-xs text-slate-700 font-medium">{klant.BijzondereKenmerken}</p>
                                    </div>
                                  </div>
                                )}

                                {/* Prioriteiten */}
                                {klant.Prioriteiten && (Array.isArray(klant.Prioriteiten) ? klant.Prioriteiten.length > 0 : klant.Prioriteiten) && (
                                  <div>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">⭐ Prioriteiten</p>
                                    <div className="flex flex-wrap gap-1">
                                      {(Array.isArray(klant.Prioriteiten) ? klant.Prioriteiten : klant.Prioriteiten.split(',')).map((p: string, i: number) => p.trim() && (
                                        <span key={i} className="px-1.5 py-0.5 bg-amber-50 text-amber-700 text-[10px] rounded font-semibold capitalize">{p.trim()}</span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* Interessante woningen Column */}
                            <td className="px-4 py-5 border-l border-slate-300 align-top min-w-[180px] max-w-[220px]">
                              <div className="flex flex-col gap-2">
                                {klant.interessante_woningen && klant.interessante_woningen.length > 0 && (
                                  <div className="flex flex-col gap-2 mb-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
                                    {klant.interessante_woningen.map((w: any, i: number) => (
                                      <div key={w.id || i} 
                                        onClick={() => openEditActionModal('interessante_woning', klant, w)}
                                        className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-left cursor-pointer hover:border-emerald-400 hover:shadow-sm transition-all group">
                                        <p className="text-xs font-bold text-slate-800 group-hover:text-emerald-700 transition-colors">{w.adres || 'Onbekend adres'}</p>
                                        {w.notities && <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">{w.notities}</p>}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <button
                                  onClick={() => setActionModal({ isOpen: true, type: 'interessante_woning', klantId: klant.id, klantNaam: klant.Naam })}
                                  className="flex items-center gap-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl px-3 py-2 transition-all border border-dashed border-emerald-300 hover:border-emerald-500 w-full justify-center font-semibold text-sm"
                                  title="Woning toevoegen"
                                >
                                  <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-lg leading-none">+</span>
                                  Woning toevoegen
                                </button>
                              </div>
                            </td>

                            {/* Bezichtigingen Column */}
                            <td className="px-6 py-5 border-l border-slate-300 align-top min-w-[260px]">
                              <div className="flex flex-col gap-2">
                                {klant.bezichtigingen && klant.bezichtigingen.length > 0 && (
                                  <div className="flex flex-col gap-2.5 mb-2 max-h-96 overflow-y-auto custom-scrollbar pr-1">
                                    {klant.bezichtigingen.map((b: any, i: number) => (
                                      <div key={b.id || i} 
                                        onClick={() => openEditActionModal('bezichtiging', klant, b)}
                                        className="bg-white/95 border border-slate-200 rounded-xl p-3.5 text-left cursor-pointer hover:border-emerald-400 hover:shadow-sm transition-all duration-200 group relative">
                                        
                                        {/* Woningadres */}
                                        <p className="text-xs font-bold text-[#2d3e50] group-hover:text-[#e74c3c] transition-colors line-clamp-1">{b.adres || 'Onbekend adres'}</p>
                                        
                                        {/* Inline inputs for date and time */}
                                        <div className="mt-2.5 space-y-2" onClick={e => e.stopPropagation()}>
                                          <div>
                                            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Datum bezichtiging</label>
                                            <div className="flex gap-1.5">
                                              <input 
                                                type="date" 
                                                value={b.datum || ''} 
                                                onChange={e => handleUpdateBezichtigingField(klant.id, b.id, 'datum', e.target.value)}
                                                className="text-[11px] px-2 py-1 border border-slate-200 bg-slate-50/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium text-slate-700 w-full"
                                              />
                                              <input 
                                                type="time" 
                                                value={b.tijd || ''} 
                                                onChange={e => handleUpdateBezichtigingField(klant.id, b.id, 'tijd', e.target.value)}
                                                className="text-[11px] px-2 py-1 border border-slate-200 bg-slate-50/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium text-slate-700 w-24"
                                              />
                                            </div>
                                          </div>
                                          
                                          {/* Status select (shows red when 'geweest') */}
                                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Status</span>
                                            <select 
                                              value={b.status || 'gepland'} 
                                              onChange={e => handleUpdateBezichtigingField(klant.id, b.id, 'status', e.target.value)}
                                              className={`text-[9px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full border transition-all duration-200 bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/20 ${
                                                b.status === 'geweest' 
                                                  ? 'bg-red-50 text-red-600 border-red-200/80' 
                                                  : b.status === 'geannuleerd'
                                                  ? 'bg-slate-100 text-slate-500 border-slate-200/80'
                                                  : 'bg-blue-50 text-blue-600 border-blue-200/80'
                                              }`}
                                            >
                                              <option value="gepland">Gepland</option>
                                              <option value="geweest">Geweest</option>
                                              <option value="geannuleerd">Geannuleerd</option>
                                            </select>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <button
                                  onClick={() => setActionModal({ isOpen: true, type: 'bezichtiging', klantId: klant.id, klantNaam: klant.Naam })}
                                  className="flex items-center gap-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl px-3 py-2 transition-all border border-dashed border-emerald-300 hover:border-emerald-500 w-full justify-center font-semibold text-sm"
                                  title="Bezichtiging toevoegen"
                                >
                                  <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-lg leading-none">+</span>
                                  Bezichtiging toevoegen
                                </button>
                              </div>
                            </td>

                            {/* Biedingen Column */}
                            <td className="px-6 py-5 border-l border-slate-300 align-top min-w-[220px]">
                              <div className="flex flex-col gap-2">
                                {klant.biedingen && klant.biedingen.length > 0 && (
                                  <div className="flex flex-col gap-2 mb-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
                                    {klant.biedingen.map((b: any, i: number) => {
                                      const isAfgewezen = b.status?.toLowerCase() === 'afgewezen';
                                      const isToegewezen = b.status?.toLowerCase() === 'toegewezen';
                                      return (
                                      <div key={b.id || i} 
                                        onClick={() => openEditActionModal('bieding', klant, b)}
                                        className={`border rounded-lg p-3 pb-8 text-left cursor-pointer transition-all group flex flex-col gap-1.5 relative ${
                                          isAfgewezen ? 'bg-red-50 border-red-200 hover:border-red-400 hover:shadow-sm' : 
                                          isToegewezen ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-400 hover:shadow-sm' : 
                                          'bg-white border-slate-200 hover:border-slate-400 hover:shadow-sm'
                                        }`}>
                                        
                                        <div>
                                          <p className={`text-xs font-bold transition-colors ${isAfgewezen ? 'text-red-800' : isToegewezen ? 'text-emerald-800' : 'text-slate-800'}`}>{b.adres || 'Onbekend adres'}</p>
                                          <p className={`text-xs font-bold ${isAfgewezen ? 'text-red-600' : isToegewezen ? 'text-emerald-600' : 'text-blue-600'}`}>Bod: € {b.bedrag || '?'}</p>
                                          {b.datum && b.tijd && (
                                            <p className={`text-[10px] font-medium mt-0.5 ${isAfgewezen ? 'text-red-500' : isToegewezen ? 'text-emerald-500' : 'text-slate-500'}`}>Deadline: {formatDateToNL(b.datum)} om {b.tijd}</p>
                                          )}
                                        </div>

                                        <select
                                          value={b.status || 'In overweging'}
                                          onChange={(e) => handleUpdateBiedingStatus(klant.id, b.id, e.target.value, e)}
                                          onClick={(e) => e.stopPropagation()}
                                          className={`absolute bottom-2 right-2 px-2 py-0.5 text-[10px] font-bold border rounded transition-colors shadow-sm outline-none cursor-pointer ${
                                            isAfgewezen ? 'text-red-700 bg-red-100 border-red-300' :
                                            isToegewezen ? 'text-emerald-700 bg-emerald-100 border-emerald-300' :
                                            'text-slate-700 bg-slate-100 border-slate-300'
                                          }`}
                                        >
                                          <option value="In overweging">In overweging</option>
                                          <option value="Toegewezen">Toegewezen</option>
                                          <option value="Afgewezen">Afgewezen</option>
                                        </select>

                                        {(b.voorwaarden?.length > 0 || b.heeftPersoonlijkBericht || b.aanvaardingstermijn || b.heeftNotariskeuze) && (
                                          <div className={`mt-0.5 pt-1.5 border-t ${isAfgewezen ? 'border-red-200/80' : isToegewezen ? 'border-emerald-200/80' : 'border-slate-200/80'}`}>
                                            {b.voorwaarden?.includes('financiering') && (
                                              <p className={`text-[10px] ${isAfgewezen ? 'text-red-600/80' : isToegewezen ? 'text-emerald-600/80' : 'text-slate-600'}`}>• Financiering {b.bedragFinanciering ? `(€ ${b.bedragFinanciering})` : ''}</p>
                                            )}
                                            {b.voorwaarden?.includes('bouwkundig') && (
                                              <p className={`text-[10px] ${isAfgewezen ? 'text-red-600/80' : isToegewezen ? 'text-emerald-600/80' : 'text-slate-600'}`}>• Bouwkundig</p>
                                            )}
                                            {b.voorwaarden?.includes('verkoop_eigen_woning') && (
                                              <p className={`text-[10px] ${isAfgewezen ? 'text-red-600/80' : isToegewezen ? 'text-emerald-600/80' : 'text-slate-600'}`}>• Verkoop eigen woning</p>
                                            )}
                                            {b.heeftPersoonlijkBericht && (
                                              <p className={`text-[10px] ${isAfgewezen ? 'text-red-600/80' : isToegewezen ? 'text-emerald-600/80' : 'text-slate-600'}`}>• Motivatiebrief</p>
                                            )}
                                            {b.aanvaardingstermijn && (
                                              <p className={`text-[10px] ${isAfgewezen ? 'text-red-600/80' : isToegewezen ? 'text-emerald-600/80' : 'text-slate-600'}`}>• Aanvaarding: {b.aanvaardingstermijn}</p>
                                            )}
                                            {b.heeftNotariskeuze && (
                                              <p className={`text-[10px] ${isAfgewezen ? 'text-red-600/80' : isToegewezen ? 'text-emerald-600/80' : 'text-slate-600'}`}>• Notaris: {b.notarisBieding || 'Aankoopklant'}</p>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )})}
                                  </div>
                                )}
                                <button
                                  onClick={() => setActionModal({ isOpen: true, type: 'bieding', klantId: klant.id, klantNaam: klant.Naam })}
                                  className="flex items-center gap-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl px-3 py-2 transition-all border border-dashed border-emerald-300 hover:border-emerald-500 w-full justify-center font-semibold text-sm"
                                  title="Bieding toevoegen"
                                >
                                  <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-lg leading-none">+</span>
                                  Bieding toevoegen
                                </button>
                              </div>
                            </td>

                            {/* Concept Koopcontract Column */}
                            <td className="px-6 py-5 border-l border-slate-300 align-top text-center min-w-[220px]">
                              <div className="flex flex-col gap-2">
                                {klant.koopcontracten && klant.koopcontracten.length > 0 && (
                                  <div className="flex flex-col gap-2 mb-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
                                    {klant.koopcontracten.map((k: any, i: number) => {
                                      if (!k) return null;
                                      return (
                                        <div key={k.id || i} 
                                          onClick={() => openEditActionModal('contract', klant, k)}
                                          className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-left cursor-pointer hover:border-emerald-400 hover:shadow-sm transition-all group">
                                          <p className="text-xs font-bold text-slate-800 group-hover:text-emerald-700 transition-colors">{k.adres || 'Onbekend adres'}</p>
                                          <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold capitalize bg-amber-100 text-amber-700">
                                            {k.status || 'concept'}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                <button
                                  onClick={() => setActionModal({ isOpen: true, type: 'contract', klantId: klant.id, klantNaam: klant.Naam })}
                                  className="flex items-center gap-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl px-3 py-2 transition-all border border-dashed border-emerald-300 hover:border-emerald-500 w-full justify-center font-semibold text-sm"
                                  title="Koopovereenkomst toevoegen"
                                >
                                  <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-lg leading-none">+</span>
                                  Koopovereenkomst toevoegen
                                </button>
                              </div>
                            </td>

                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  )}
                </motion.div>
              ) : activeView === 'nieuwste' ? (
                <motion.div
                  key="nieuwste"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-8"
                >
                    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
                      <div>
                        <h2 className="text-2xl sm:text-4xl font-bold text-[#2d3e50] mb-1">Nieuwste Huizen Scans</h2>
                        <p className="text-slate-500">Overzicht van de nieuwste woningen uit onze scans</p>
                      </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                      <button
                        onClick={refreshScans}
                        disabled={refreshingScans}
                        className={`flex items-center justify-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm shadow-sm border transition-all ${
                          refreshingScans 
                          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          : 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700 active:scale-95'
                        }`}
                      >
                        <RefreshCw size={18} className={refreshingScans ? 'animate-spin' : ''} />
                        {refreshingScans ? 'Verversen...' : 'Scans verversen'}
                      </button>
                      <div className="hidden sm:flex bg-slate-100 text-slate-600 px-5 py-3 rounded-2xl font-bold text-sm items-center gap-3 shadow-sm border border-slate-200">
                        <Clock size={18} />
                        Laatste update: {new Date().toLocaleDateString('nl-NL')}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-12 pb-12">
                    {loadingScans ? (
                      <div className="flex justify-center p-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                      </div>
                    ) : scanRuns.length > 0 ? (
                      <>
                        {(() => {
                          const activeRun = scanRuns[currentNieuwsteRunIndex];
                          if (!activeRun) return null;
                          
                          return (
                            <div className="bg-[#1e293b] text-white p-6 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg border border-slate-800">
                              <div className="flex items-center gap-4">
                                <div className="bg-slate-800 p-3.5 rounded-xl border border-slate-700 text-emerald-500">
                                  <Calendar size={26} />
                                </div>
                                <div>
                                  <span className="text-xs text-emerald-400 font-bold uppercase tracking-wider block mb-0.5">Scraper Run</span>
                                  <h3 className="text-xl sm:text-2xl font-black tracking-tight">{activeRun.title}</h3>
                                  <span className="text-xs text-slate-400">Totaal {activeRun.houses.length} gescande woningen</span>
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-3">
                                <button
                                  disabled={currentNieuwsteRunIndex >= scanRuns.length - 1}
                                  onClick={() => setCurrentNieuwsteRunIndex(prev => prev + 1)}
                                  className={`p-2.5 rounded-xl border transition-all ${
                                    currentNieuwsteRunIndex >= scanRuns.length - 1
                                    ? 'bg-slate-800/50 text-slate-600 border-slate-800/80 cursor-not-allowed'
                                    : 'bg-slate-800 text-white border-slate-700 hover:bg-slate-700 hover:border-slate-600 active:scale-95'
                                  }`}
                                  title="Vorige run"
                                >
                                  <ChevronLeft size={20} />
                                </button>
                                <span className="text-sm font-bold text-slate-300">
                                  Run {currentNieuwsteRunIndex + 1} / {scanRuns.length}
                                </span>
                                <button
                                  disabled={currentNieuwsteRunIndex <= 0}
                                  onClick={() => setCurrentNieuwsteRunIndex(prev => prev - 1)}
                                  className={`p-2.5 rounded-xl border transition-all ${
                                    currentNieuwsteRunIndex <= 0
                                    ? 'bg-slate-800/50 text-slate-600 border-slate-800/80 cursor-not-allowed'
                                    : 'bg-slate-800 text-white border-slate-700 hover:bg-slate-700 hover:border-slate-600 active:scale-95'
                                  }`}
                                  title="Volgende run"
                                >
                                  <ChevronRight size={20} />
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                        {regionOrder.map(region => (
                          groupedScans[region] && groupedScans[region].length > 0 && (
                            <div key={region} className="space-y-6">
                              <div className="flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-4 mb-5 sm:mb-8">
                                <h3 className="text-3xl sm:text-6xl font-black text-[#2d3e50] capitalize tracking-tighter">
                                  {region}
                                </h3>
                                <span className="text-lg sm:text-2xl font-bold text-slate-300">
                                  — {groupedScans[region].length} woningen
                                </span>
                              </div>
                              <div className="grid grid-cols-1 gap-8">
                                {groupedScans[region].map((scan) => (
                                  <HouseScanCard key={`${scan.ID}-${scan.adres}`} scan={scan} matches={matches} />
                                ))}
                              </div>
                            </div>
                          )
                        ))}
                      </>
                    ) : (
                      <div className="text-center p-20 text-slate-400 font-medium">
                        Geen scans gevonden. Nieuwe huizen verschijnen hier zodra de scraper draait.
                      </div>
                    )}
                  </div>
                </motion.div>

              ) : activeView === 'matches' ? (
                <motion.div
                  key="matches"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-8"
                >
                    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
                      <div>
                        <h2 className="text-2xl sm:text-4xl font-bold text-[#2d3e50] mb-1">Klant Matches</h2>
                        <p className="text-slate-500">AI-geanalyseerde matches op basis van klantprofielen uit Firestore</p>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                        <select
                          value={clientMatchFilter || ''}
                          onChange={(e) => setClientMatchFilter(e.target.value || null)}
                          className="px-4 py-3 bg-white border border-slate-200 rounded-2xl font-bold text-sm text-[#2d3e50] focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all min-w-[200px] cursor-pointer shadow-sm"
                        >
                          <option value="">Alle klanten</option>
                          {sortedKlantenLijst.map((k) => (
                            <option key={k.id} value={k.Naam}>{k.Naam}</option>
                          ))}
                        </select>
                        <button
                          onClick={refreshMatches}
                          disabled={refreshing}
                          className={`flex items-center justify-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm shadow-sm border transition-all ${
                            refreshing
                            ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                            : 'bg-blue-600 text-white border-blue-700 hover:bg-blue-700 active:scale-95'
                          }`}
                        >
                          <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
                          {refreshing ? 'Verversen...' : 'Matches verversen'}
                        </button>
                      </div>
                    </div>

                  <div className="flex flex-col gap-8 pb-12">
                    {/* Firestore Match Tijdstip Banner met Historische Navigatie */}
                    {!loading && matchRuns.length > 0 && (() => {
                      const activeRun = matchRuns[currentRunIndex];
                      if (!activeRun) return null;
                      const rawDatum = activeRun.datum;
                      const d = new Date(rawDatum);
                      const isValid = !isNaN(d.getTime());
                      const datumStr = isValid 
                        ? d.toLocaleDateString('nl-NL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
                        : activeRun.id;
                      const tijdStr = isValid 
                        ? d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
                        : '';
                        
                      const hasOlder = currentRunIndex < matchRuns.length - 1;
                      const hasNewer = currentRunIndex > 0;

                      return (
                        <div className="flex flex-col sm:flex-row sm:items-center gap-5 bg-gradient-to-r from-[#141e2b] to-[#1e2f42] rounded-3xl px-6 py-6 shadow-xl relative overflow-hidden group">
                          {/* Background Glow */}
                          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-blue-500/10 to-transparent rounded-full blur-2xl pointer-events-none" />
                          
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center flex-shrink-0 backdrop-blur-md shadow-inner border border-white/10">
                              <Calendar size={22} className="text-[#4db6ac]" />
                            </div>
                            <div>
                              <p className="text-white/60 text-xs font-black uppercase tracking-[0.2em] mb-1">Matches aangemaakt op</p>
                              <p className="text-white text-xl sm:text-2xl font-black leading-none mb-1.5 capitalize">{datumStr}</p>
                              {tijdStr && <p className="text-[#4db6ac] text-sm font-bold">om {tijdStr} uur</p>}
                            </div>
                          </div>

                          {/* Historical navigation arrows & stats */}
                          <div className="flex items-center justify-between sm:justify-start gap-4 sm:ml-auto border-t sm:border-t-0 border-white/10 pt-4 sm:pt-0">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => hasOlder && setCurrentRunIndex(prev => prev + 1)}
                                disabled={!hasOlder}
                                className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all border ${
                                  hasOlder 
                                    ? 'bg-white/5 border-white/10 text-white hover:bg-white/15 active:scale-95' 
                                    : 'bg-white/0 border-white/5 text-white/20 cursor-not-allowed'
                                }`}
                                title="Vorige matches (ouder)"
                              >
                                <ChevronLeft size={20} />
                              </button>
                              
                              <span className="text-white/70 text-sm font-bold px-2 tabular-nums">
                                Run {currentRunIndex + 1} / {matchRuns.length}
                              </span>

                              <button
                                onClick={() => hasNewer && setCurrentRunIndex(prev => prev - 1)}
                                disabled={!hasNewer}
                                className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all border ${
                                  hasNewer 
                                    ? 'bg-white/5 border-white/10 text-white hover:bg-white/15 active:scale-95' 
                                    : 'bg-white/0 border-white/5 text-white/20 cursor-not-allowed'
                                }`}
                                title="Volgende matches (nieuwer)"
                              >
                                <ChevronRight size={20} />
                              </button>
                            </div>
                            
                            <div className="text-right sm:pl-4 sm:border-l border-white/10">
                              <span className="text-[#4db6ac] text-xs font-bold uppercase tracking-wider block mb-0.5">Totaal</span>
                              <span className="text-white text-xl font-black tabular-nums">{activeRun.matches.length} match{activeRun.matches.length !== 1 ? 'es' : ''}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {clientMatchFilter && (
                      <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-3xl px-6 py-4 shadow-sm animate-fade-in">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
                            <Sparkles size={18} />
                          </div>
                          <div>
                            <p className="text-blue-900 font-bold text-sm">Actief filter</p>
                            <p className="text-blue-700 text-xs font-semibold">
                              Matches voor <span className="font-extrabold underline">{clientMatchFilter}</span>
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setClientMatchFilter(null)}
                          className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 border border-blue-200 text-blue-700 rounded-xl font-bold text-xs sm:text-sm transition-all active:scale-95 shadow-sm"
                        >
                          <X size={14} />
                          Wis filter
                        </button>
                      </div>
                    )}

                    {loading ? (
                      <div className="flex justify-center p-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                      </div>
                    ) : matchRuns.length > 0 && matchRuns[currentRunIndex] ? (() => {
                      const rawMatches = matchRuns[currentRunIndex].matches;
                      const filtered = clientMatchFilter 
                        ? rawMatches.filter((m: any) => {
                            const mName = (m.clientName || '').toLowerCase();
                            const filterName = clientMatchFilter.toLowerCase();
                            return mName.includes(filterName) || filterName.includes(mName.split(' ')[0]);
                          })
                        : rawMatches;
                        
                      if (filtered.length === 0) {
                        return (
                          <div className="text-center p-16 text-slate-400 bg-white rounded-3xl border border-slate-100 shadow-sm font-medium">
                            <Users size={48} className="mx-auto mb-3 text-slate-300" />
                            <p className="font-bold text-slate-700">Geen matches gevonden</p>
                            <p className="text-xs text-slate-400 mt-1">Er zijn momenteel geen matches voor {clientMatchFilter} in deze run.</p>
                          </div>
                        );
                      }

                      const isInvalidOrUnknownAddress = (address?: string): boolean => {
                        if (!address) return true;
                        const addr = address.trim().toLowerCase();
                        return (
                          addr === '' ||
                          addr === 'onbekend' ||
                          addr === 'onbekend adres' ||
                          addr.startsWith('http://') ||
                          addr.startsWith('https://') ||
                          addr.includes('exchange-object') ||
                          addr.includes('/') ||
                          addr.includes('.nl') ||
                          addr.includes('.com')
                        );
                      };

                      const validMatches = filtered.filter((m: any) => !isInvalidOrUnknownAddress(m.address));
                      const invalidMatches = filtered.filter((m: any) => isInvalidOrUnknownAddress(m.address));
                      
                      const getKlantStatusPriority = (matchName?: string) => {
                        const klant = klantenLijst.find((k: any) => 
                          k.Naam && matchName && 
                          (k.Naam.includes(matchName) || matchName.includes(k.Naam.split(' ')[0]))
                        );
                        if (!klant) return 3;
                        const s = (klant.Status || 'actief').toLowerCase();
                        if (s === 'actief') return 1;
                        if (s === 'prospect') return 2;
                        return 3;
                      };

                      return (
                        <div className="space-y-8">
                          {validMatches.length > 0 && [...validMatches]
                            .sort((a, b) => {
                              const prioA = getKlantStatusPriority(a.clientName);
                              const prioB = getKlantStatusPriority(b.clientName);
                              if (prioA !== prioB) return prioA - prioB;
                              return b.matchPercentage - a.matchPercentage;
                            })
                            .map((match: any) => (
                              <MatchCard key={match.id} match={match} klanten={klantenLijst} scans={houseScans} onAddInteressanteWoning={handleAddInteressanteWoningFromMatch} />
                            ))
                          }
                          
                          {invalidMatches.length > 0 && (
                            <div className="mt-12 space-y-6">
                              <div className="border-t border-slate-300 pt-8">
                                <h3 className="text-xl sm:text-2xl font-bold text-slate-500 mb-2 flex items-center gap-2">
                                  <MapPinOff size={22} className="text-slate-400 animate-pulse" />
                                  Adres onbekend
                                </h3>
                                <p className="text-slate-400 text-sm mb-6">
                                  Matches met woningen waarvan het adres niet correct kon worden vastgesteld (bijvoorbeeld door ontbrekende gegevens of tijdelijke links).
                                </p>
                              </div>
                              {[...invalidMatches]
                                .sort((a, b) => {
                                  const prioA = getKlantStatusPriority(a.clientName);
                                  const prioB = getKlantStatusPriority(b.clientName);
                                  if (prioA !== prioB) return prioA - prioB;
                                  return b.matchPercentage - a.matchPercentage;
                                })
                                .map((match: any) => (
                                  <MatchCard key={match.id} match={match} klanten={klantenLijst} scans={houseScans} onAddInteressanteWoning={handleAddInteressanteWoningFromMatch} />
                                ))
                              }
                            </div>
                          )}
                        </div>
                      );
                    })() : (
                      <div className="text-center p-20 text-slate-400 font-medium">
                        Geen matches beschikbaar in Firestore.
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : activeView === 'klanten' ? (
                <KlantenView 
                   klanten={sortedKlantenLijst} 
                   refreshing={refreshingKlanten} 
                   onRefresh={refreshKlanten} 
                   selectedStatuses={selectedStatuses}
                   setSelectedStatuses={setSelectedStatuses}
                   onAddKlant={() => { setEditingKlantId(null); resetAddKlantForm(); setShowAddKlantModal(true); }} 
                   onDeleteKlant={handleDeleteKlant}
                   onEditKlant={handleEditKlant}
                   deletingId={deletingKlantId}
                   onShowMatchesForKlant={(name) => {
                     setClientMatchFilter(name);
                     setActiveView('matches');
                   }}
                />
              ) : activeView === 'blog-post-maker' ? (
                <BlogPostMakerView key="blog-post-maker" />
              ) : activeView === 'database' ? (
                <motion.div
                  key="database"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-3xl font-black text-[#2d3e50] tracking-tight">Database <span className="text-blue-600">Overzicht</span></h2>
                      <p className="text-slate-500">Alle {databaseScans.length} huizen uit de Firestore 'NieuweHuizenPerScrape' collectie</p>
                    </div>
                    <button
                      onClick={fetchDatabaseScans}
                      disabled={loadingDatabase}
                      className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors text-slate-600 self-start sm:self-end"
                      title="Ververs database"
                    >
                      <RefreshCw size={20} className={loadingDatabase ? 'animate-spin' : ''} />
                    </button>
                  </div>

                  <div className="glass-card p-5 sm:p-6 border border-slate-200 shadow-lg">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="relative">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Zoeken</label>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                          <input
                            type="text"
                            placeholder="Zoek op adres of makelaar..."
                            value={dbSearchTerm}
                            onChange={(e) => setDbSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all"
                          />
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Woonplaats</label>
                        <input
                          type="text"
                          placeholder="Filter op woonplaats..."
                          value={dbFilterPlaats}
                          onChange={(e) => setDbFilterPlaats(e.target.value)}
                          className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2 lg:col-span-2">
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Prijs van</label>
                          <input
                            type="number"
                            placeholder="€ 0"
                            value={dbFilterPrijsVan}
                            onChange={(e) => setDbFilterPrijsVan(e.target.value === '' ? '' : Number(e.target.value))}
                            className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Prijs tot</label>
                          <input
                            type="number"
                            placeholder="Geen max"
                            value={dbFilterPrijsTot}
                            onChange={(e) => setDbFilterPrijsTot(e.target.value === '' ? '' : Number(e.target.value))}
                            className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all"
                          />
                        </div>
                      </div>
                    </div>
                    
                    {/* Tweede rij met extra filters */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5 mt-5 border-t border-slate-100">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Datum van</label>
                          <input
                            type="date"
                            value={dbFilterDatumVan}
                            onChange={(e) => setDbFilterDatumVan(e.target.value)}
                            className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all text-slate-600"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Datum tot</label>
                          <input
                            type="date"
                            value={dbFilterDatumTot}
                            onChange={(e) => setDbFilterDatumTot(e.target.value)}
                            className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all text-slate-600"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Dagdeel</label>
                        <select
                          value={dbFilterDagdeel}
                          onChange={(e) => setDbFilterDagdeel(e.target.value)}
                          className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all appearance-none cursor-pointer text-slate-600"
                        >
                          <option value="Alle">Alle tijdstippen</option>
                          <option value="Ochtend">Ochtend (voor 12:00)</option>
                          <option value="Middag">Middag / Avond (vanaf 12:00)</option>
                        </select>
                      </div>
                      <div className="flex items-end">
                        <label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-not-allowed hover:bg-slate-50 transition-colors w-full h-[46px] opacity-60">
                          <input
                            type="checkbox"
                            disabled={true}
                            checked={dbFilterNieuw}
                            onChange={(e) => setDbFilterNieuw(e.target.checked)}
                            className="w-5 h-5 rounded border-slate-300 text-slate-400 focus:ring-0 cursor-not-allowed"
                          />
                          <span className="text-sm font-bold text-slate-500">Alleen Nieuw (1e keer)</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="glass-card overflow-hidden border border-slate-200 shadow-xl">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-widest font-black border-b border-slate-100">
                            <th className="px-6 py-4">Datum</th>
                            <th className="px-6 py-4">Adres</th>
                            <th className="px-6 py-4">Plaats</th>
                            <th className="px-6 py-4">Prijs</th>
                            <th className="px-6 py-4">Makelaar</th>
                            <th className="px-6 py-4">Link</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {databaseScans
                            .filter(s => {
                              const searchTerm = dbSearchTerm.toLowerCase();
                              const searchMatch = !dbSearchTerm || 
                                String(s.adres || '').toLowerCase().includes(searchTerm) ||
                                String(s.Makelaar || '').toLowerCase().includes(searchTerm);
                              
                              const plaatsMatch = !dbFilterPlaats || 
                                String(s.Plaats || '').toLowerCase().includes(dbFilterPlaats.toLowerCase());

                              const housePrice = parsePrice(s.Prijs);
                              const prijsVanMatch = dbFilterPrijsVan === '' || housePrice >= dbFilterPrijsVan;
                              const prijsTotMatch = dbFilterPrijsTot === '' || housePrice <= dbFilterPrijsTot;

                              let datumMatch = true;
                              const houseDate = parseScanDate(s.Datum);
                              if (houseDate) {
                                houseDate.setHours(0, 0, 0, 0);
                                if (dbFilterDatumVan) {
                                  const dateVan = new Date(dbFilterDatumVan);
                                  dateVan.setHours(0, 0, 0, 0);
                                  if (houseDate < dateVan) datumMatch = false;
                                }
                                if (dbFilterDatumTot) {
                                  const dateTot = new Date(dbFilterDatumTot);
                                  dateTot.setHours(0, 0, 0, 0);
                                  if (houseDate > dateTot) datumMatch = false;
                                }
                              } else {
                                if (dbFilterDatumVan || dbFilterDatumTot) {
                                  datumMatch = false;
                                }
                              }

                              let dagdeelMatch = true;
                              if (dbFilterDagdeel !== 'Alle') {
                                const timeMatch = String(s.Datum || '').match(/\s(\d{2}):/);
                                if (timeMatch) {
                                  const hour = parseInt(timeMatch[1], 10);
                                  if (dbFilterDagdeel === 'Ochtend' && hour >= 12) dagdeelMatch = false;
                                  if (dbFilterDagdeel === 'Middag' && hour < 12) dagdeelMatch = false;
                                } else {
                                  dagdeelMatch = false;
                                }
                              }

                              let nieuwMatch = true;
                              if (dbFilterNieuw) {
                                const hoevaak = String(s.Hoevaak || s.hoevaak || '').toLowerCase();
                                nieuwMatch = hoevaak.includes('1e') || hoevaak === 'nieuw' || hoevaak === '1';
                                if (!s.Hoevaak && !s.hoevaak) nieuwMatch = false;
                              }

                              return searchMatch && plaatsMatch && prijsVanMatch && prijsTotMatch && datumMatch && dagdeelMatch && nieuwMatch;
                            })
                            .slice(0, 500)
                            .map((scan, i) => (
                            <tr key={i} className="hover:bg-slate-50/80 transition-colors text-sm">
                              <td className="px-6 py-4 text-slate-400 font-mono text-[11px] whitespace-nowrap">{scan.Datum}</td>
                              <td className="px-6 py-4 font-bold text-slate-700">{scan.adres}</td>
                              <td className="px-6 py-4 text-slate-600">{scan.Plaats}</td>
                              <td className="px-6 py-4 font-black text-blue-600">{scan.Prijs}</td>
                              <td className="px-6 py-4 text-slate-500">{scan.Makelaar}</td>
                              <td className="px-6 py-4">
                                <a 
                                  href={scan.link} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all inline-flex items-center"
                                >
                                  <ExternalLink size={14} />
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {databaseScans.length > 500 && !dbSearchTerm && !dbFilterPlaats && dbFilterPrijsVan === '' && dbFilterPrijsTot === '' && (
                        <div className="p-4 bg-slate-50 text-center text-xs text-slate-400">
                          Toont de eerste 500 resultaten. Gebruik de zoekbalk of filters om specifieke woningen te vinden.
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ) : activeView === 'tasks' ? (
                <motion.div
                  key="tasks"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6"
                >
                  <TaskList klanten={sortedKlantenLijst} scans={databaseScans} />
                </motion.div>
              ) : activeView === 'stable' ? (
                <motion.div
                  key="stable"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[100] bg-gradient-to-br from-red-600 to-rose-800 flex flex-col items-center justify-center text-white"
                >
                  <div className="text-center space-y-6 px-4">
                    <Heart className="w-32 h-32 animate-pulse mx-auto fill-white text-white filter drop-shadow-lg" />
                    <h1 className="text-6xl font-black tracking-widest uppercase animate-bounce drop-shadow-md">
                      Stabiele Versie
                    </h1>
                    <p className="text-xl opacity-90 max-w-md mx-auto font-medium">
                      Dit is de definitieve back-up en stabiele versie van de WoonWensManager.
                    </p>
                    <button
                      onClick={() => setActiveView('nieuwste')}
                      className="mt-8 px-8 py-4 bg-white text-red-600 font-extrabold rounded-full hover:bg-red-50 transition-all hover:scale-105 shadow-xl cursor-pointer"
                    >
                      Terug naar het Dashboard
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
            
            {/* Add Klant Wizard - multi-step accordion */}
            <AnimatePresence>
              {showAddKlantModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={() => { setShowAddKlantModal(false); resetAddKlantForm(); }}
                    className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.97, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: 20 }}
                    className="relative w-full bg-white shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
                    style={{ maxWidth: 980, maxHeight: '92vh', borderRadius: 6 }}
                  >
                    {/* Modal header */}
                    <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-white flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[#141e2b] flex items-center justify-center text-[#e67e22]">
                          <UserPlus size={20} />
                        </div>
                        <h2 className="text-xl font-bold text-[#2d3e50]">
                          {editingKlantId ? 'Zoekprofiel bewerken' : 'Nieuw zoekprofiel toevoegen'}
                        </h2>
                      </div>
                      <button type="button" onClick={() => { setShowAddKlantModal(false); resetAddKlantForm(); }}
                        className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400">
                        <X size={17} />
                      </button>
                    </div>

                    {/* Scrollable accordion body */}
                    <div className="overflow-y-auto flex-1">

                      {/* ── Stap 1: Relatie ── */}
                      <div className="border-b border-slate-200">
                        <button type="button" onClick={() => setAddKlantStep(addKlantStep === 1 ? 0 : 1)}
                          className={`w-full flex items-center gap-2 px-5 py-3 text-left text-sm font-semibold transition-colors
                            ${addKlantStep === 1 ? 'bg-[#cfe2f3] text-[#1a5c8a]' : 'bg-[#e8f4fb] text-[#2d3e50] hover:bg-[#daeaf7]'}`}>
                          <span className="text-xs">{addKlantStep === 1 ? '▾' : '▸'}</span>
                          Stap 1. Relatie
                        </button>
                        {addKlantStep === 1 && (
                          <div className="px-8 py-5 bg-white">
                            <div className="max-w-xs">
                              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Naam klant *</label>
                              <input required type="text" value={newKlant.Naam}
                                onChange={e => setNewKlant({ ...newKlant, Naam: e.target.value })}
                                className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                                placeholder="Bijv. Familie de Vries" />
                            </div>
                            <div className="mt-5 flex justify-center">
                              <button type="button" disabled={!newKlant.Naam.trim()}
                                onClick={() => setAddKlantStep(2)}
                                className="px-10 py-1.5 bg-[#5b9bd5] hover:bg-[#4a8ac4] disabled:opacity-40 text-white text-sm font-medium rounded border border-[#3a7ab4] transition-colors">
                                Volgende stap
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* ── Stap 2: Locatie ── */}
                      <div className="border-b border-slate-200">
                        <button type="button" onClick={() => setAddKlantStep(addKlantStep === 2 ? 0 : 2)}
                          className={`w-full flex items-center gap-2 px-5 py-3 text-left text-sm font-semibold transition-colors
                            ${addKlantStep === 2 ? 'bg-[#cfe2f3] text-[#1a5c8a]' : 'bg-[#e8f4fb] text-[#2d3e50] hover:bg-[#daeaf7]'}`}>
                          <span className="text-xs">{addKlantStep === 2 ? '▾' : '▸'}</span>
                          Stap 2. Locatie
                        </button>
                        {addKlantStep === 2 && (
                          <div className="px-4 sm:px-8 py-5 bg-white">
                            <div className="flex flex-col gap-4">
                              {/* Location search */}
                              <div className="w-full">
                                <p className="text-xs text-slate-600 mb-1.5">Selecteer een locatie</p>
                                <div className="flex gap-1 mb-1.5">
                                  <select value={newKlant.LocatieFilter}
                                    onChange={e => setNewKlant({ ...newKlant, LocatieFilter: e.target.value })}
                                    className="px-1.5 py-1 border border-slate-300 rounded text-xs bg-white focus:outline-none">
                                    {['Alles','Provincie','Gemeente','Wijk','Postcodegebied'].map(f => <option key={f}>{f}</option>)}
                                  </select>
                                  <div className="flex-1 flex items-center border border-slate-300 rounded bg-white px-2 gap-1">
                                    <input type="text" value={newKlant.LocatieZoekterm}
                                      onChange={e => setNewKlant({ ...newKlant, LocatieZoekterm: e.target.value })}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          const loc = newKlant.LocatieZoekterm.trim();
                                          if (loc && !newKlant.GeselecteerdeLocaties.includes(loc)) {
                                            setNewKlant({ ...newKlant, GeselecteerdeLocaties: [...newKlant.GeselecteerdeLocaties, loc], LocatieZoekterm: '' });
                                            setLocatieError(false);
                                          }
                                        }
                                      }}
                                      className="flex-1 py-1 text-xs outline-none bg-transparent"
                                      placeholder="Typ uw locatie" />
                                    <button type="button" onClick={() => {
                                      const loc = newKlant.LocatieZoekterm.trim();
                                      if (loc && !newKlant.GeselecteerdeLocaties.includes(loc)) {
                                        setNewKlant({ ...newKlant, GeselecteerdeLocaties: [...newKlant.GeselecteerdeLocaties, loc], LocatieZoekterm: '' });
                                        setLocatieError(false);
                                      }
                                    }} className="text-slate-400 hover:text-blue-500">
                                      <Search size={13} />
                                    </button>
                                  </div>
                                </div>
                                {newKlant.GeselecteerdeLocaties.length === 0 ? (
                                  <p className="text-xs text-slate-400 italic">U heeft nog geen nieuwe locaties toegevoegd.</p>
                                ) : (
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {newKlant.GeselecteerdeLocaties.map((loc, i) => (
                                      <span key={i} className="flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded border border-blue-200">
                                        {loc}
                                        <button type="button"
                                          onClick={() => {
                                            setNewKlant(prev => {
                                              const removedLoc = prev.GeselecteerdeLocaties[i];
                                              if (!removedLoc) return prev;
                                              const newCoords = { ...prev.GeselecteerdeCoords };
                                              delete newCoords[removedLoc];
                                              return { 
                                                ...prev, 
                                                GeselecteerdeLocaties: prev.GeselecteerdeLocaties.filter((_, idx) => idx !== i),
                                                GeselecteerdeCoords: newCoords
                                              };
                                            });
                                          }}
                                          className="hover:text-red-600 leading-none ml-0.5">×</button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {/* Map */}
                              <div className="w-full" style={{ minHeight: 300 }}>
                                <MapSelector 
                                  selectedLocations={newKlant.GeselecteerdeLocaties}
                                  selectedCoords={newKlant.GeselecteerdeCoords}
                                  onSelect={(loc, coords) => {
                                    setNewKlant(prev => {
                                      const hasLoc = prev.GeselecteerdeLocaties.includes(loc);
                                      const hasCoords = !!prev.GeselecteerdeCoords[loc];
                                      if (hasLoc && hasCoords && prev.GeselecteerdeCoords[loc][0] === coords[0]) return prev;

                                      return { 
                                        ...prev, 
                                        GeselecteerdeLocaties: hasLoc ? prev.GeselecteerdeLocaties : [...prev.GeselecteerdeLocaties, loc],
                                        GeselecteerdeCoords: { ...prev.GeselecteerdeCoords, [loc]: coords }
                                      };
                                    });
                                    setLocatieError(false);
                                  }}
                                />
                              </div>
                            </div>
                            {locatieError && (
                              <div className="mt-3 border-l-4 border-red-500 bg-red-50 px-3 py-2">
                                <p className="text-red-600 text-xs">Selecteer a.u.b. een of meerdere locaties</p>
                              </div>
                            )}
                            <div className="mt-5 flex justify-center">
                              <button type="button" onClick={() => {
                               if (newKlant.GeselecteerdeLocaties.length === 0) { setLocatieError(true); return; }
                               setLocatieError(false);
                               setNewKlant(prev => ({ ...prev, Regio: prev.GeselecteerdeLocaties.join(', ') }));
                               setAddKlantStep(3);
                              }} className="px-10 py-1.5 bg-[#5b9bd5] hover:bg-[#4a8ac4] text-white text-sm font-medium rounded border border-[#3a7ab4] transition-colors">
                                Volgende stap
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* ── Stap 3: Woonwensen ── */}
                      <div className="border-b border-slate-200">
                        <button type="button" onClick={() => setAddKlantStep(addKlantStep === 3 ? 0 : 3)}
                          className={`w-full flex items-center gap-2 px-5 py-3 text-left text-sm font-semibold transition-colors
                            ${addKlantStep === 3 ? 'bg-[#cfe2f3] text-[#1a5c8a]' : 'bg-[#e8f4fb] text-[#2d3e50] hover:bg-[#daeaf7]'}`}>
                          <span className="text-xs">{addKlantStep === 3 ? '▾' : '▸'}</span>
                          Stap 3. Woonwensen
                        </button>
                        {addKlantStep === 3 && (
                          <div className="px-4 sm:px-8 py-5 bg-white">
                            {/* Match percentage */}
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700 mb-5">
                              <span>Stuur alleen emails met woningen die voor minimaal</span>
                              <select value={newKlant.MinMatchPercentage}
                                onChange={e => setNewKlant({ ...newKlant, MinMatchPercentage: e.target.value })}
                                className="px-1.5 py-1 border border-slate-300 rounded text-xs bg-white focus:outline-none">
                                {['60','65','70','75','80','85','90','95','100'].map(p => <option key={p} value={p}>{p}%</option>)}
                              </select>
                              <span>aan de woonwensen voldoen.</span>
                            </div>

                            <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
                              {/* Left column */}
                              <div className="w-full lg:w-44 flex-shrink-0 space-y-4">
                                <div>
                                  <p className="text-xs font-semibold text-slate-700 mb-1.5">Soort</p>
                                  {[['koop','Koop'],['huur','Huur']].map(([v,l]) => (
                                    <label key={v} className="flex items-center gap-2 text-xs mb-1 cursor-pointer">
                                      <input type="radio" name="soort_wz" value={v} checked={newKlant.Soort === v}
                                        onChange={() => setNewKlant({...newKlant, Soort: v})} className="accent-blue-500" />
                                      {l}
                                    </label>
                                  ))}
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-slate-700 mb-1.5">Prijsklasse</p>
                                  <div className="flex items-center gap-1 mb-1">
                                    <span className="text-red-500 text-[10px]">*</span>
                                    <span className="text-xs text-slate-600 w-7">Van</span>
                                    <span className="text-xs">€</span>
                                    <input type="text" value={newKlant.Prijsklasse}
                                      onChange={e => setNewKlant({...newKlant, Prijsklasse: e.target.value})}
                                      className="w-20 px-1.5 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-xs text-slate-600 w-11">Max.</span>
                                    <span className="text-xs">€</span>
                                    <input type="text" value={newKlant.PrijsMax}
                                      onChange={e => setNewKlant({...newKlant, PrijsMax: e.target.value})}
                                      className="w-20 px-1.5 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                  </div>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-slate-700 mb-1.5">Bouwvorm</p>
                                  {[['bestaand','Bestaande bouw'],['nieuwbouw','Nieuwbouw'],['beide','Beide']].map(([v,l]) => (
                                    <label key={v} className="flex items-center gap-2 text-xs mb-1 cursor-pointer">
                                      <input type="radio" name="bouwvorm_wz" value={v} checked={newKlant.Bouwvorm === v}
                                        onChange={() => setNewKlant({...newKlant, Bouwvorm: v})} className="accent-blue-500" />
                                      {l}
                                    </label>
                                  ))}
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-slate-700 mb-1.5">Objectsoort</p>
                                  {[['woonhuis_appartement','Woonhuis / Appartement'],['woonhuis','Woonhuis'],['appartement','Appartement'],['bouwgrond','Bouwgrond'],['overig','Overig']].map(([v,l]) => (
                                    <label key={v} className="flex items-center gap-2 text-xs mb-1 cursor-pointer">
                                      <input type="radio" name="objectsoort_wz" value={v} checked={newKlant.Objectsoort === v}
                                        onChange={() => setNewKlant({...newKlant, Objectsoort: v})} className="accent-blue-500" />
                                      {l}
                                    </label>
                                  ))}
                                </div>
                                <div className="border-t border-slate-200 pt-2">
                                  <button type="button" onClick={() => setShowSpecifiekeWensen(!showSpecifiekeWensen)}
                                    className="flex items-center gap-1.5 text-[#1a5c8a] text-xs font-bold uppercase tracking-wide">
                                    <span>{showSpecifiekeWensen ? '▾' : '▸'}</span>
                                    Specifieke wensen
                                  </button>
                                </div>
                              </div>

                              {/* Middle column */}
                              <div className="flex-1 space-y-4">
                                <div>
                                  <p className="text-xs font-semibold text-slate-700 mb-1.5">Woonoppervlakte</p>
                                  <div className="flex items-center gap-1.5">
                                    <input type="text" value={newKlant.Woonoppervlakte} onChange={e => setNewKlant({...newKlant, Woonoppervlakte: e.target.value})}
                                      className="w-28 px-2 py-1.5 border border-slate-300 rounded text-xs bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="Minimaal:" />
                                    <span className="text-xs text-slate-500">m²</span>
                                  </div>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-slate-700 mb-1.5">Perceeloppervlakte</p>
                                  <div className="flex items-center gap-1.5">
                                    <input type="text" value={newKlant.Perceeloppervlakte} onChange={e => setNewKlant({...newKlant, Perceeloppervlakte: e.target.value})}
                                      className="w-28 px-2 py-1.5 border border-slate-300 rounded text-xs bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="Minimaal:" />
                                    <span className="text-xs text-slate-500">m²</span>
                                  </div>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-slate-700 mb-1.5">Aantal kamers</p>
                                  <input type="text" value={newKlant.AantalKamers} onChange={e => setNewKlant({...newKlant, AantalKamers: e.target.value})}
                                    className="w-28 px-2 py-1.5 border border-slate-300 rounded text-xs bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="Minimaal:" />
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-slate-700 mb-1.5">Aantal slaapkamers</p>
                                  <input type="text" value={newKlant.AantalSlaapkamers} onChange={e => setNewKlant({...newKlant, AantalSlaapkamers: e.target.value})}
                                    className="w-28 px-2 py-1.5 border border-slate-300 rounded text-xs bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="Minimaal:" />
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-slate-700 mb-1.5">Bestemming</p>
                                  {[['permanente_bewoning','Permanente bewoning'],['recreatiewoning','Recreatiewoning']].map(([v,l]) => (
                                    <label key={v} className="flex items-center gap-2 text-xs mb-1 cursor-pointer">
                                      <input type="checkbox" checked={newKlant.Bestemming.includes(v)}
                                        onChange={e => setNewKlant({...newKlant, Bestemming: e.target.checked ? [...newKlant.Bestemming, v] : newKlant.Bestemming.filter(x => x !== v)})}
                                        className="accent-blue-500" />
                                      {l}
                                    </label>
                                  ))}
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-slate-700 mb-1.5">Dubbele bewoning</p>
                                  {['Dubbele bewoning mogelijk','Dubbele bewoning aanwezig'].map(db => (
                                    <label key={db} className="flex items-center gap-2 text-xs mb-1 cursor-pointer">
                                      <input type="checkbox" checked={newKlant.DubbeleBewoning.includes(db)}
                                        onChange={e => setNewKlant({...newKlant, DubbeleBewoning: e.target.checked ? [...newKlant.DubbeleBewoning, db] : newKlant.DubbeleBewoning.filter(v => v !== db)})}
                                        className="accent-blue-500" />
                                      {db}
                                    </label>
                                  ))}
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-slate-700 mb-1.5">Energielabel</p>
                                  <select value={newKlant.Energielabel} onChange={e => setNewKlant({...newKlant, Energielabel: e.target.value})}
                                    className="w-32 px-1.5 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none">
                                    <option value="">Selecteer</option>
                                    {['A+++','A++','A+','A','B','C','D','E','F','G'].map(l => <option key={l}>{l}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-slate-700 mb-1.5">Buitenruimte</p>
                                  {['Balkon','Tuin','Dakterras'].map(br => (
                                    <label key={br} className="flex items-center gap-2 text-xs mb-1 cursor-pointer">
                                      <input type="checkbox" checked={newKlant.Buitenruimte.includes(br)}
                                        onChange={e => setNewKlant({...newKlant, Buitenruimte: e.target.checked ? [...newKlant.Buitenruimte, br] : newKlant.Buitenruimte.filter(v => v !== br)})}
                                        className="accent-blue-500" />
                                      {br}
                                    </label>
                                  ))}
                                </div>
                              </div>

                              {/* Right: Bepaal prioriteit */}
                              <div className="w-full lg:w-52 flex-shrink-0">
                                <div className="bg-[#dbeaf7] rounded border border-[#b8d4e8] p-4">
                                  <h4 className="font-bold text-[#1a5276] text-sm mb-0.5">Bepaal prioriteit</h4>
                                  <p className="text-xs text-slate-600 mb-3">Klik op een ster als iets een absolute eis is.</p>
                                  <div className="space-y-1.5 mb-3">
                                    {[['locatie','Locatie(s)'],['prijs','Prijsklasse'],['bouwvorm','Bouwvorm'],['objectsoort','Objectsoort'],['bewoning','Permanente bewoning']].map(([key,label]) => (
                                      <button key={key} type="button"
                                        onClick={() => setNewKlant({...newKlant, Prioriteiten: newKlant.Prioriteiten.includes(key) ? newKlant.Prioriteiten.filter(p => p !== key) : [...newKlant.Prioriteiten, key]})}
                                        className="flex items-center gap-2 w-full text-left text-xs text-slate-700 hover:text-[#1a5276] group">
                                        <span className={`text-base transition-colors ${newKlant.Prioriteiten.includes(key) ? 'text-[#1a5c8a]' : 'text-slate-300 group-hover:text-[#1a5c8a]'}`}>
                                          {newKlant.Prioriteiten.includes(key) ? '★' : '☆'}
                                        </span>
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="border-t border-[#b8d4e8] pt-2.5 mb-2.5">
                                    <p className="text-xs font-bold text-slate-700 mb-1">Stuur eigen woningaanbod</p>
                                    <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                                      <input type="checkbox"
                                        checked={newKlant.StuurtEigenAanbod}
                                        onChange={e => setNewKlant({...newKlant, StuurtEigenAanbod: e.target.checked})}
                                        className="accent-blue-500" />
                                      én dat van andere makelaarskantoren
                                    </label>
                                  </div>
                                  <div className="border-t border-[#b8d4e8] pt-2.5 mb-2.5">
                                    <p className="text-xs font-bold text-slate-700 mb-1">Beschikbaar aanbod vanaf:</p>
                                    <select
                                      value={newKlant.AanbodVanaf}
                                      onChange={e => setNewKlant({...newKlant, AanbodVanaf: e.target.value})}
                                      className="w-full px-1.5 py-1 border border-slate-300 rounded text-xs bg-white focus:outline-none">
                                      <option>Afgelopen 2 weken</option>
                                      <option>Afgelopen maand</option>
                                      <option>Afgelopen 3 maanden</option>
                                      <option>Alle aanbod</option>
                                    </select>
                                  </div>
                                  <div className="border-t border-[#b8d4e8] pt-2.5 text-center">
                                    <p className="text-xs font-bold text-slate-700 mb-1">Aantal gevonden woningen:</p>
                                    <p className="text-3xl font-black text-slate-800">0</p>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Specifieke wensen uitklapper */}
                            {showSpecifiekeWensen && (
                              <div className="mt-4 border-t-2 border-[#1a5c8a]/20 pt-4">
                                <p className="text-xs font-bold text-[#1a5c8a] uppercase tracking-wide mb-3 flex items-center gap-1.5">
                                  <span>▾</span> Specifieke wensen
                                </p>
                                <CheckboxGroup title="Type woning"
                                  items={['Verspringend','Halfvrijstaande woning','Hoekwoning','2-onder-1-kap','Vrijstaande woning','Geschakelde 2-onder-1-kap','Eindwoning','Tussenwoning','Geschakelde woning']}
                                  selected={newKlant.TypeWoning} onChange={vals => setNewKlant({...newKlant, TypeWoning: vals})} />
                                <CheckboxGroup title="Soort woning"
                                  items={['Eengezinswoning','Bungalow','Stacaravan','Herenhuis','Woonboerderij','Woonwagen','Villa','Grachtenpand','Landgoed','Landhuis','Woonboot']}
                                  selected={newKlant.SoortWoning} onChange={vals => setNewKlant({...newKlant, SoortWoning: vals})} />
                                <CheckboxGroup title="Soort appartement"
                                  items={['Tussenverdieping','Studentenkamer','Penthouse','Portiekflat','Maisonnette','Boven woning','Dubbel benedenhuis','Portiekwoning','Beneden + bovenwoning','Galerijflat','Benedenwoning']}
                                  selected={newKlant.SoortAppartement} onChange={vals => setNewKlant({...newKlant, SoortAppartement: vals})} />
                                <CheckboxGroup title="Ligging"
                                  items={['Bedrijventerrein','Landelijk gelegen','In centrum','Open ligging','Vrij uitzicht','Zeezicht','Aan drukke weg','Aan water','Beschutte ligging','In bosrijke omgeving','Buiten bebouwde kom','Aan park','In woonwijk','Aan rustige weg','Aan bosrand','Aan vaarwater']}
                                  selected={newKlant.Ligging} onChange={vals => setNewKlant({...newKlant, Ligging: vals})} />

                                {/* Bijzonderheden & Toegankelijkheid */}
                                <div className="border-t border-slate-100 pt-3 flex gap-8">
                                  <div className="flex-1">
                                    <p className="text-xs font-semibold text-slate-700 mb-2">Bijzonderheden</p>
                                    {['Gedeeltelijk gestoffeerd','Gemeubileerd','Gestoffeerd','Kluswoning'].map(item => (
                                      <label key={item} className="flex items-center gap-1.5 text-xs mb-1.5 cursor-pointer hover:text-blue-600">
                                        <input type="checkbox" checked={newKlant.Bijzonderheden.includes(item)}
                                          onChange={e => setNewKlant({...newKlant, Bijzonderheden: e.target.checked ? [...newKlant.Bijzonderheden, item] : newKlant.Bijzonderheden.filter(v => v !== item)})}
                                          className="accent-blue-500 w-3.5 h-3.5" />
                                        {item}
                                      </label>
                                    ))}
                                  </div>
                                  <div className="flex-1">
                                    <p className="text-xs font-semibold text-slate-700 mb-2">Toegankelijkheid</p>
                                    {['Geschikt voor ouderen','Geschikt voor minder validen','Slaapkamer op de begane grond','Badkamer op de begane grond'].map(item => (
                                      <label key={item} className="flex items-center gap-1.5 text-xs mb-1.5 cursor-pointer hover:text-blue-600">
                                        <input type="checkbox" checked={newKlant.Toegankelijkheid.includes(item)}
                                          onChange={e => setNewKlant({...newKlant, Toegankelijkheid: e.target.checked ? [...newKlant.Toegankelijkheid, item] : newKlant.Toegankelijkheid.filter(v => v !== item)})}
                                          className="accent-blue-500 w-3.5 h-3.5" />
                                        {item}
                                      </label>
                                    ))}
                                  </div>
                                </div>

                                <OnderhoudGroup title="Onderhoud binnen" fieldName="onderhoud_binnen_wz"
                                  value={newKlant.OnderhoudBinnen} onChange={v => setNewKlant({...newKlant, OnderhoudBinnen: v})} />
                                <OnderhoudGroup title="Onderhoud buiten" fieldName="onderhoud_buiten_wz"
                                  value={newKlant.OnderhoudBuiten} onChange={v => setNewKlant({...newKlant, OnderhoudBuiten: v})} />

                                {/* Parkeren / Voorzieningen / Eigendom */}
                                <div className="border-t border-slate-100 pt-3 flex gap-8">
                                  <div>
                                    <p className="text-xs font-semibold text-slate-700 mb-2">Parkeren</p>
                                    {['Garage','Parkeerplaats'].map(item => (
                                      <label key={item} className="flex items-center gap-1.5 text-xs mb-1.5 cursor-pointer hover:text-blue-600">
                                        <input type="checkbox" checked={newKlant.Parkeren.includes(item)}
                                          onChange={e => setNewKlant({...newKlant, Parkeren: e.target.checked ? [...newKlant.Parkeren, item] : newKlant.Parkeren.filter(v => v !== item)})}
                                          className="accent-blue-500 w-3.5 h-3.5" />
                                        {item}
                                      </label>
                                    ))}
                                  </div>
                                  <div>
                                    <p className="text-xs font-semibold text-slate-700 mb-2">Voorzieningen</p>
                                    {['Lift','Berging','Zonnepanelen','Jacuzzi','Zwembad'].map(item => (
                                      <label key={item} className="flex items-center gap-1.5 text-xs mb-1.5 cursor-pointer hover:text-blue-600">
                                        <input type="checkbox" checked={newKlant.Voorzieningen.includes(item)}
                                          onChange={e => setNewKlant({...newKlant, Voorzieningen: e.target.checked ? [...newKlant.Voorzieningen, item] : newKlant.Voorzieningen.filter(v => v !== item)})}
                                          className="accent-blue-500 w-3.5 h-3.5" />
                                        {item}
                                      </label>
                                    ))}
                                  </div>
                                  <div>
                                    <p className="text-xs font-semibold text-slate-700 mb-2">Eigendom</p>
                                    {['Geen erfpacht','Alleen erfpacht indien afgekocht'].map(item => (
                                      <label key={item} className="flex items-center gap-1.5 text-xs mb-1.5 cursor-pointer hover:text-blue-600">
                                        <input type="checkbox" checked={newKlant.Eigendom.includes(item)}
                                          onChange={e => setNewKlant({...newKlant, Eigendom: e.target.checked ? [...newKlant.Eigendom, item] : newKlant.Eigendom.filter(v => v !== item)})}
                                          className="accent-blue-500 w-3.5 h-3.5" />
                                        {item}
                                      </label>
                                    ))}
                                  </div>
                                </div>

                                {/* Bouwjaar */}
                                <div className="border-t border-slate-100 pt-3">
                                  <p className="text-xs font-semibold text-slate-700 mb-2">Bouwjaar</p>
                                  <div className="flex items-center gap-3 mb-1.5">
                                    <span className="text-xs text-slate-600 w-6">Van</span>
                                    <input type="text" value={newKlant.BouwjaarVan} onChange={e => setNewKlant({...newKlant, BouwjaarVan: e.target.value})}
                                      className="w-20 px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-slate-50" />
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-slate-600 w-6">t/m</span>
                                    <input type="text" value={newKlant.BouwjaarTm} onChange={e => setNewKlant({...newKlant, BouwjaarTm: e.target.value})}
                                      className="w-20 px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-slate-50" />
                                  </div>
                                </div>
                              </div>
                            )}

                            <div className="mt-5 flex justify-center">
                              <button type="button" onClick={() => setAddKlantStep(4)}
                                className="px-10 py-1.5 bg-[#5b9bd5] hover:bg-[#4a8ac4] text-white text-sm font-medium rounded border border-[#3a7ab4] transition-colors">
                                Volgende stap
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* ── Stap 4: Instellingen ── */}
                      <div>
                        <button type="button" onClick={() => setAddKlantStep(addKlantStep === 4 ? 0 : 4)}
                          className={`w-full flex items-center gap-2 px-5 py-3 text-left text-sm font-semibold transition-colors
                            ${addKlantStep === 4 ? 'bg-[#cfe2f3] text-[#1a5c8a]' : 'bg-[#e8f4fb] text-[#2d3e50] hover:bg-[#daeaf7]'}`}>
                          <span className="text-xs">{addKlantStep === 4 ? '▾' : '▸'}</span>
                          Stap 4. Instellingen
                        </button>
                        {addKlantStep === 4 && (
                          <form onSubmit={handleAddKlant} className="px-8 py-5 bg-white">
                            <div className="max-w-sm space-y-4">
                              <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">E-mailadres klant</label>
                                <input type="email" value={newKlant.Email}
                                  onChange={e => setNewKlant({...newKlant, Email: e.target.value})}
                                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                                  placeholder="naam@voorbeeld.nl" />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Notificatiefrequentie</label>
                                <select value={newKlant.Notificatie} onChange={e => setNewKlant({...newKlant, Notificatie: e.target.value})}
                                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm bg-white focus:outline-none">
                                  <option value="direct">Direct (zodra beschikbaar)</option>
                                  <option value="dagelijks">Dagelijks overzicht</option>
                                  <option value="wekelijks">Wekelijks overzicht</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Status Profiel</label>
                                <select value={newKlant.Status} onChange={e => setNewKlant({...newKlant, Status: e.target.value})}
                                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                                  <option value="actief">Actief</option>
                                  <option value="prospect">Prospect</option>
                                  <option value="inactief">Inactief</option>
                                  <option value="aangekocht">Aangekocht</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Extra notities</label>
                                <textarea rows={3} value={newKlant.Notities}
                                  onChange={e => setNewKlant({...newKlant, Notities: e.target.value})}
                                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                                  placeholder="Interne notities..." />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Essentieel</label>
                                <textarea rows={3} value={newKlant.BijzondereKenmerken}
                                  onChange={e => setNewKlant({...newKlant, BijzondereKenmerken: e.target.value})}
                                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                                  placeholder="Specifieke woonwensen..." />
                              </div>
                            </div>
                            <div className="mt-5 flex justify-center gap-3">
                              <button type="button"
                                onClick={() => { setShowAddKlantModal(false); resetAddKlantForm(); }}
                                className="px-6 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded transition-colors">
                                Annuleren
                              </button>
                              <button type="submit" disabled={submittingKlant}
                                className="px-10 py-1.5 bg-[#5b9bd5] hover:bg-[#4a8ac4] disabled:opacity-50 text-white text-sm font-medium rounded border border-[#3a7ab4] transition-colors flex items-center gap-2">
                                {submittingKlant ? <RefreshCw size={14} className="animate-spin" /> : editingKlantId ? <CheckCircle2 size={14} /> : <UserPlus size={14} />}
                                {editingKlantId ? 'Wijzigingen Opslaan' : 'Profiel Opslaan'}
                              </button>
                            </div>
                          </form>
                        )}
                      </div>

                    </div>{/* end scrollable body */}
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* --- Action Modal (Bezichtiging, Bieding, etc.) --- */}
        <AnimatePresence>
          {actionModal && (
            <div className="fixed inset-0 bg-[#0f172a]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
              >
                {/* Header */}
                <div className="px-6 py-4 bg-gradient-to-r from-[#2d3e50] to-[#1a5c8a] flex justify-between items-center text-white">
                  <div>
                    <h3 className="font-bold text-lg leading-tight capitalize">
                      {actionModal.actionId 
                        ? `${actionModal.type === 'contract' ? 'koopovereenkomst' : actionModal.type === 'interessante_woning' ? 'interessante woning' : actionModal.type} bewerken` 
                        : `${actionModal.type === 'contract' ? 'koopovereenkomst' : actionModal.type === 'interessante_woning' ? 'interessante woning' : actionModal.type} toevoegen`}
                    </h3>
                    <p className="text-blue-100 text-xs">Voor: {actionModal.klantNaam}</p>
                  </div>
                  <button onClick={() => { setActionModal(null); setResearchStatus('idle'); }} className="p-1 hover:bg-white/10 rounded-full transition-colors text-white/80 hover:text-white">
                    <X size={20} />
                  </button>
                </div>

                {/* Formulier */}
                <form onSubmit={handleSaveAction} className="p-6 overflow-y-auto custom-scrollbar flex-1">
                  <div className="space-y-4">
                    {/* Always show Adres */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">Woningadres</label>
                      <input type="text" required value={actionForm.adres}
                        onChange={e => setActionForm({...actionForm, adres: e.target.value})}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                        placeholder="Bijv. Dorpsstraat 10, Maastricht" />
                    </div>

                    {/* Type specific fields */}
                    {actionModal.type === 'bezichtiging' && (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Datum</label>
                            <input type="date" required value={actionForm.datum}
                              onChange={e => setActionForm({...actionForm, datum: e.target.value})}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tijd</label>
                            <input type="time" value={actionForm.tijd}
                              onChange={e => setActionForm({...actionForm, tijd: e.target.value})}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Status</label>
                          <select value={actionForm.status} onChange={e => setActionForm({...actionForm, status: e.target.value})}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50">
                            <option value="gepland">Gepland</option>
                            <option value="geweest">Geweest</option>
                            <option value="geannuleerd">Geannuleerd</option>
                          </select>
                        </div>
                      </>
                    )}

                    {actionModal.type === 'bieding' && (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Prijs (Bieding)</label>
                            <div className="relative">
                              <span className="absolute left-3 top-2 text-xs text-slate-400 font-bold">€</span>
                              <input type="number" required value={actionForm.prijs}
                                onChange={e => setActionForm({...actionForm, prijs: e.target.value})}
                                className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                                placeholder="Bijv. 350000" />
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Deadline (Datum + Tijd)</label>
                            <div className="flex gap-2">
                              <input type="date" required value={actionForm.datum}
                                onChange={e => setActionForm({...actionForm, datum: e.target.value})}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all" />
                              <input type="time" required value={actionForm.tijd}
                                onChange={e => setActionForm({...actionForm, tijd: e.target.value})}
                                className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all" />
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Verkopend makelaar</label>
                          <input type="text" value={actionForm.verkopendMakelaar}
                            onChange={e => setActionForm({...actionForm, verkopendMakelaar: e.target.value})}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                            placeholder="Naam makelaar / kantoor" />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5 font-bold text-slate-600">Voorwaarden</label>
                          <div className="space-y-2 bg-slate-50 border border-slate-200 rounded-xl p-3.5 shadow-inner">
                            {[
                              { key: 'financiering', label: 'Financieringsvoorbehoud' },
                              { key: 'bouwkundig', label: 'Bouwkundig voorbehoud' },
                              { key: 'verkoop_eigen_woning', label: 'Verkoop eigen woning' }
                            ].map(item => {
                              const isChecked = actionForm.voorwaarden.includes(item.key);
                              return (
                                <div key={item.key} className="flex flex-col gap-2">
                                  <label className="flex items-center gap-2.5 text-xs text-slate-700 font-semibold cursor-pointer select-none">
                                    <input type="checkbox" checked={isChecked}
                                      onChange={e => {
                                        const next = e.target.checked 
                                          ? [...actionForm.voorwaarden, item.key]
                                          : actionForm.voorwaarden.filter(k => k !== item.key);
                                        setActionForm({...actionForm, voorwaarden: next});
                                      }}
                                      className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500/30" />
                                    {item.label}
                                  </label>
                                  {item.key === 'financiering' && isChecked && (
                                    <div className="ml-6 flex items-center gap-2">
                                      <span className="text-xs text-slate-500 font-medium">Bedrag:</span>
                                      <div className="relative flex-1">
                                        <span className="absolute left-2.5 top-1.5 text-xs text-slate-400 font-bold">€</span>
                                        <input type="number" 
                                          value={actionForm.bedragFinanciering}
                                          onChange={e => setActionForm({...actionForm, bedragFinanciering: e.target.value})}
                                          className="w-full pl-6 pr-2 py-1.5 border border-slate-200 rounded-md text-xs focus:outline-none focus:border-emerald-500" 
                                          placeholder="Bijv. 300000" />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            
                            <hr className="my-3 border-slate-200" />
                            
                            <label className="flex items-center gap-2.5 text-xs text-slate-700 font-semibold cursor-pointer select-none">
                              <input type="checkbox" checked={actionForm.heeftPersoonlijkBericht}
                                onChange={e => setActionForm({...actionForm, heeftPersoonlijkBericht: e.target.checked})}
                                className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500/30" />
                              Persoonlijk bericht (motivatiebrief) meegeleverd
                            </label>

                            <div className="mt-3">
                              <label className="block text-xs font-semibold text-slate-600 mb-1">Voorkeur aanvaardingstermijn</label>
                              <input type="text" value={actionForm.aanvaardingstermijn}
                                onChange={e => setActionForm({...actionForm, aanvaardingstermijn: e.target.value})}
                                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-emerald-500"
                                placeholder="Bijv. 3 maanden of in overleg" />
                            </div>

                            <div className="mt-3">
                              <label className="flex items-center gap-2.5 text-xs text-slate-700 font-semibold cursor-pointer select-none mb-1">
                                <input type="checkbox" checked={actionForm.heeftNotariskeuze}
                                  onChange={e => setActionForm({...actionForm, heeftNotariskeuze: e.target.checked})}
                                  className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500/30" />
                                Voorkeur notaris
                              </label>
                              {actionForm.heeftNotariskeuze && (
                                <input type="text" value={actionForm.notarisBieding}
                                  onChange={e => setActionForm({...actionForm, notarisBieding: e.target.value})}
                                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-emerald-500 ml-6 w-[calc(100%-1.5rem)]"
                                  placeholder="Naam voorkeursnotaris..." />
                              )}
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {actionModal.type === 'contract' && (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Transportdatum</label>
                            <input type="date" value={actionForm.datumTransport}
                              onChange={e => setActionForm({...actionForm, datumTransport: e.target.value})}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Datum concept koopakte</label>
                            <input type="date" required value={actionForm.datumInvoer}
                              onChange={e => setActionForm({...actionForm, datumInvoer: e.target.value})}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all" />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Koopsom</label>
                            <div className="relative">
                              <span className="absolute left-3 top-2 text-xs text-slate-400 font-bold">€</span>
                              <input type="number" required value={actionForm.koopsom}
                                onChange={e => setActionForm({...actionForm, koopsom: e.target.value})}
                                className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                                placeholder="Bijv. 350000" />
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Notariskeuze</label>
                            <input type="text" value={actionForm.notariskeuze}
                              onChange={e => setActionForm({...actionForm, notariskeuze: e.target.value})}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                              placeholder="Naam notaris..." />
                          </div>
                        </div>

                        <div className="mt-4">
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Verkopend makelaar</label>
                          <input type="text" value={actionForm.verkopendMakelaar}
                            onChange={e => setActionForm({...actionForm, verkopendMakelaar: e.target.value})}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                            placeholder="Naam makelaar / kantoor" />
                        </div>

                        <div className="grid grid-cols-2 gap-4 mt-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Financieringsvoorbehoud</label>
                            <input type="date" value={actionForm.datumFinanciering}
                              onChange={e => setActionForm({...actionForm, datumFinanciering: e.target.value})}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Bouwkundig voorbehoud</label>
                            <input type="date" value={actionForm.datumBouwkundig}
                              onChange={e => setActionForm({...actionForm, datumBouwkundig: e.target.value})}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all" />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Verkoop eigen woning</label>
                            <input type="date" value={actionForm.datumVerkoopEigen}
                              onChange={e => setActionForm({...actionForm, datumVerkoopEigen: e.target.value})}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Datum waarborgsom</label>
                            <input type="date" value={actionForm.datumWaarborgsom}
                              onChange={e => setActionForm({...actionForm, datumWaarborgsom: e.target.value})}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all" />
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5 font-bold text-slate-600">Voorwaarden</label>
                          <div className="space-y-2 bg-slate-50 border border-slate-200 rounded-xl p-3.5 shadow-inner">
                            {[
                              { key: 'financiering', label: 'Financieringsvoorbehoud' },
                              { key: 'bouwkundig', label: 'Bouwkundig voorbehoud' },
                              { key: 'verkoop_eigen_woning', label: 'Verkoop eigen woning' }
                            ].map(item => {
                              const isChecked = actionForm.voorwaarden.includes(item.key);
                              return (
                                <div key={item.key} className="flex flex-col gap-2">
                                  <label className="flex items-center gap-2.5 text-xs text-slate-700 font-semibold cursor-pointer select-none">
                                    <input type="checkbox" checked={isChecked}
                                      onChange={e => {
                                        const next = e.target.checked 
                                          ? [...actionForm.voorwaarden, item.key]
                                          : actionForm.voorwaarden.filter(k => k !== item.key);
                                        setActionForm({...actionForm, voorwaarden: next});
                                      }}
                                      className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500/30" />
                                    {item.label}
                                  </label>
                                  {item.key === 'financiering' && isChecked && (
                                    <div className="ml-6 flex items-center gap-2">
                                      <span className="text-xs text-slate-500 font-medium">Bedrag:</span>
                                      <div className="relative flex-1">
                                        <span className="absolute left-2.5 top-1.5 text-xs text-slate-400 font-bold">€</span>
                                        <input type="number" 
                                          value={actionForm.bedragFinanciering}
                                          onChange={e => setActionForm({...actionForm, bedragFinanciering: e.target.value})}
                                          className="w-full pl-6 pr-2 py-1.5 border border-slate-200 rounded-md text-xs focus:outline-none focus:border-emerald-500" 
                                          placeholder="Bijv. 300000" />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}

                    {/* Always show Notities */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">Interne Notities</label>
                      <textarea rows={3} value={actionForm.notities}
                        onChange={e => setActionForm({...actionForm, notities: e.target.value})}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none"
                        placeholder="Opmerkingen..." />
                    </div>
                  </div>

                  <div className="mt-8 flex flex-wrap gap-2 justify-between items-center">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={handleFetchResearch} disabled={researchStatus === 'loading'}
                        className="px-3 py-1.5 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold transition-all flex items-center gap-1.5 border border-indigo-200/60 shadow-sm whitespace-nowrap">
                        {researchStatus === 'loading' ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                        Haal research op
                      </button>
                      
                      {actionModal.actionId && (
                        <button type="button" onClick={handleDeleteAction}
                          className="px-3 py-1.5 text-xs text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg font-semibold transition-all flex items-center gap-1.5 border border-rose-200/60 shadow-sm whitespace-nowrap">
                          <Trash2 size={14} />
                          Verwijderen
                        </button>
                      )}
                    </div>
                    
                    <div className="flex flex-wrap gap-2">
                      {actionModal.actionId && actionModal.type !== 'contract' && (
                        <button type="button" onClick={handleMoveToNextRow}
                          className="px-3 py-1.5 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg font-semibold transition-all flex items-center gap-1.5 border border-indigo-200/60 shadow-sm whitespace-nowrap">
                          Volgende rij <ArrowRight size={14} />
                        </button>
                      )}
                      <button type="button" onClick={() => { setActionModal(null); setResearchStatus('idle'); }}
                        className="px-3 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg font-semibold transition-all whitespace-nowrap">
                        Annuleren
                      </button>
                      <button type="submit"
                        className="px-4 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold shadow-sm transition-all flex items-center gap-1.5 whitespace-nowrap">
                        <CheckCircle2 size={14} />
                        Opslaan
                      </button>
                    </div>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* --- Google Agenda Double Check Modal --- */}
        <AnimatePresence>
        </AnimatePresence>

        {/* Full Screen Research Report Modal */}
        <AnimatePresence>
          {showFullReport && actionModal && (
            <div className="fixed inset-0 z-[100] overflow-y-auto print-container bg-white/40 backdrop-blur-md">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="max-w-5xl mx-auto my-8 min-h-screen sm:min-h-[calc(100vh-4rem)] bg-white/95 shadow-2xl sm:rounded-3xl print:shadow-none print:max-w-none print:w-full print:m-0 print:rounded-none overflow-hidden border border-white/40"
              >
                {/* Header (No-print buttons) */}
                <div className="no-print sticky top-0 bg-white/90 backdrop-blur-md border-b border-slate-100 px-6 sm:px-10 py-4 flex flex-wrap justify-between items-center z-20 shadow-sm gap-4">
                  <div className="flex items-center gap-4">
                    <button onClick={() => setShowFullReport(false)} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors text-slate-600 shadow-inner">
                      <X size={20} />
                    </button>
                    <h2 className="text-lg font-bold text-[#2d3e50]">Research Rapport Preview</h2>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => window.print()} className="px-6 py-2.5 bg-[#141e2b] hover:bg-slate-800 text-white font-bold rounded-2xl shadow-lg transition-all flex items-center gap-2 group">
                      <Printer size={18} className="group-hover:-translate-y-0.5 transition-transform" />
                      Download als PDF
                    </button>
                  </div>
                </div>

                {/* Report Content */}
                <div className="p-8 sm:p-14 space-y-12">
                  {/* Title & Branding */}
                  <div className="border-b-2 border-slate-200 pb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                    <div>
                      <h1 className="text-3xl sm:text-4xl font-black text-[#2d3e50] mb-2 tracking-tight">Woning Analyse</h1>
                      <p className="text-xl sm:text-2xl text-[#5b9bd5] font-bold">{actionForm.adres || 'Onbekend Adres'}</p>
                      <div className="mt-4 inline-flex items-center gap-2 bg-slate-50 border border-slate-200 px-4 py-2 rounded-xl">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Klant</span>
                        <span className="font-bold text-[#2d3e50]">{actionModal.klantNaam}</span>
                      </div>
                    </div>
                    <div className="text-left md:text-right">
                      <div className="font-bold text-lg mb-2">
                        <span className="text-[#e67e22]">Woon</span><span className="text-[#2d3e50]">Wens</span> <span className="font-medium text-slate-400 text-sm">Client Management</span>
                      </div>
                      <p className="text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full inline-block">
                        SCAN: {new Date().toLocaleDateString('nl-NL')}
                      </p>
                    </div>
                  </div>

                  {/* Sectie 1 */}
                  <section>
                    <h3 className="text-xl font-bold text-[#2d3e50] mb-6 flex items-center gap-3 border-b-2 border-slate-100 pb-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#5b9bd5] flex items-center justify-center"><MapPin size={20} /></div>
                      Locatie & Bereikbaarheid <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-1 rounded-full ml-2 font-bold tracking-wider no-print">MOCK DATA</span>
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-100 shadow-sm">
                        <span className="text-3xl mb-3 block opacity-80">🛒</span>
                        <p className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1">Supermarkt</p>
                        <p className="font-black text-[#2d3e50] text-lg">450 m</p>
                        <p className="text-xs font-semibold text-[#5b9bd5]">5 min lopen</p>
                      </div>
                      <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-100 shadow-sm">
                        <span className="text-3xl mb-3 block opacity-80">🛍️</span>
                        <p className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1">Winkelcentrum</p>
                        <p className="font-black text-[#2d3e50] text-lg">1.2 km</p>
                        <p className="text-xs font-semibold text-[#5b9bd5]">7 min fietsen</p>
                      </div>
                      <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-100 shadow-sm">
                        <span className="text-3xl mb-3 block opacity-80">🎓</span>
                        <p className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1">Basisschool</p>
                        <p className="font-black text-[#2d3e50] text-lg">800 m</p>
                        <p className="text-xs font-semibold text-[#5b9bd5]">3 min fietsen</p>
                      </div>
                      <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-100 shadow-sm">
                        <span className="text-3xl mb-3 block opacity-80">🚆</span>
                        <p className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1">Treinstation</p>
                        <p className="font-black text-[#2d3e50] text-lg">2.5 km</p>
                        <p className="text-xs font-semibold text-[#5b9bd5]">10 min fietsen</p>
                      </div>
                    </div>
                  </section>

                  {/* Sectie 2 */}
                  <section>
                    <h3 className="text-xl font-bold text-[#2d3e50] mb-6 flex items-center gap-3 border-b-2 border-slate-100 pb-3">
                      <div className="w-10 h-10 rounded-xl bg-orange-50 text-[#e67e22] flex items-center justify-center"><Users size={20} /></div>
                      Buurtprofiel & Leefbaarheid <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-1 rounded-full ml-2 font-bold tracking-wider no-print">MOCK DATA</span>
                    </h3>
                    <div className="grid md:grid-cols-2 gap-8">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-700 mb-3">Demografie (Leeftijdsopbouw)</h4>
                        <div className="space-y-3">
                          <div>
                            <div className="flex justify-between text-xs font-bold mb-1.5">
                              <span className="text-[#2d3e50]">Jongeren (0-25)</span>
                              <span className="text-[#5b9bd5]">22%</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden print-only-bg">
                              <div className="bg-[#5b9bd5] h-full rounded-full" style={{ width: '22%' }}></div>
                            </div>
                          </div>
                          <div>
                            <div className="flex justify-between text-xs font-bold mb-1.5">
                              <span className="text-[#2d3e50]">Gezinnen (25-45)</span>
                              <span className="text-[#141e2b]">45%</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden print-only-bg">
                              <div className="bg-[#141e2b] h-full rounded-full" style={{ width: '45%' }}></div>
                            </div>
                          </div>
                          <div>
                            <div className="flex justify-between text-xs font-bold mb-1.5">
                              <span className="text-[#2d3e50]">Ouderen (45+)</span>
                              <span className="text-[#e67e22]">33%</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden print-only-bg">
                              <div className="bg-[#e67e22] h-full rounded-full" style={{ width: '33%' }}></div>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="space-y-6">
                        <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-100">
                          <div className="flex justify-between items-center mb-3">
                            <h4 className="text-sm font-bold text-[#2d3e50]">Stress niveau</h4>
                            <span className="text-xs font-black text-white bg-[#58b19f] px-3 py-1 rounded-full shadow-sm">LAAG (2/10)</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-3.5 overflow-hidden flex shadow-inner">
                            <div className="bg-[#58b19f] h-full w-1/5 border-r border-white/50"></div>
                            <div className="bg-[#58b19f] h-full w-1/5 border-r border-white/50"></div>
                            <div className="h-full w-1/5 border-r border-white/50"></div>
                            <div className="h-full w-1/5 border-r border-white/50"></div>
                            <div className="h-full w-1/5"></div>
                          </div>
                          <p className="text-[10px] font-medium text-slate-500 mt-2">Gebaseerd op geluidsoverlast, luchtkwaliteit en verkeersdrukte.</p>
                        </div>
                        
                        <div className="bg-white p-5 rounded-2xl border border-[#58b19f]/30 shadow-sm flex items-start gap-4">
                          <div className="w-10 h-10 rounded-full bg-[#58b19f]/10 flex items-center justify-center shrink-0">
                            <CheckCircle2 size={24} className="text-[#58b19f]" />
                          </div>
                          <div>
                            <h4 className="text-sm font-black text-[#2d3e50]">Zeer Veilige Buurt</h4>
                            <p className="text-xs font-medium text-slate-600 mt-1.5 leading-relaxed">Criminaliteitscijfers liggen 15% onder het landelijk gemiddelde. Inbraakpreventie is goed geregeld.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Sectie 3 */}
                  <section>
                    <h3 className="text-xl font-bold text-[#2d3e50] mb-6 flex items-center gap-3 border-b-2 border-slate-100 pb-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center"><LineChart size={20} /></div>
                      Financiële Analyse <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-1 rounded-full ml-2 font-bold tracking-wider no-print">MOCK DATA</span>
                    </h3>
                    <div className="grid md:grid-cols-2 gap-6">
                      {/* Bar Chart */}
                      <div className="bg-slate-50/80 p-6 rounded-3xl border border-slate-100 shadow-sm">
                        <p className="text-sm font-black text-[#2d3e50] mb-8">Gemiddelde Vraagprijs</p>
                        <div className="flex items-end justify-center gap-16 h-48 relative">
                          {/* Y-as */}
                          <div className="absolute left-0 top-0 bottom-6 flex flex-col justify-between text-[10px] text-slate-400 font-bold">
                            <span>€500k</span>
                            <span>€250k</span>
                            <span>€0</span>
                          </div>
                          <div className="absolute left-12 right-0 bottom-6 border-b-2 border-slate-200"></div>
                          
                          <div className="flex flex-col items-center gap-3 z-10 w-20 group">
                            <div className="text-sm font-black text-[#141e2b]">€ 380k</div>
                            <div className="w-full bg-[#141e2b] rounded-t-xl h-[76%] shadow-md group-hover:bg-slate-800 transition-colors"></div>
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Regio</span>
                          </div>
                          <div className="flex flex-col items-center gap-3 z-10 w-20 group">
                            <div className="text-sm font-black text-slate-400">€ 430k</div>
                            <div className="w-full bg-slate-200 rounded-t-xl h-[86%] shadow-sm"></div>
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Land</span>
                          </div>
                        </div>
                      </div>

                      {/* Trendlijn */}
                      <div className="bg-slate-50/80 p-6 rounded-3xl border border-slate-100 shadow-sm">
                        <p className="text-sm font-black text-[#2d3e50] mb-4">Prijsontwikkeling (5 jaar)</p>
                        <div className="relative h-48 w-full pt-6">
                          <svg viewBox="0 0 100 40" className="w-full h-full overflow-visible">
                            <path d="M 0 35 Q 20 30, 40 20 T 70 15 T 100 5" fill="none" stroke="#e67e22" strokeWidth="2.5" strokeLinecap="round" className="drop-shadow-sm" />
                            <circle cx="0" cy="35" r="2" fill="#e67e22" />
                            <circle cx="40" cy="20" r="2" fill="#e67e22" />
                            <circle cx="70" cy="15" r="2" fill="#e67e22" />
                            <circle cx="100" cy="5" r="2.5" fill="#e67e22" stroke="white" strokeWidth="1" />
                          </svg>
                          <div className="absolute top-2 right-2 bg-orange-100 text-[#e67e22] px-3 py-1.5 rounded-lg text-xs font-black shadow-sm">
                            + 24.5% sinds 2021
                          </div>
                          <div className="flex justify-between w-full mt-4 text-[10px] font-bold text-slate-400 border-t-2 border-slate-200 pt-2 uppercase tracking-wider">
                            <span>2021</span>
                            <span>2023</span>
                            <span>Nu</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Sectie 4 */}
                  <section>
                    <h3 className="text-xl font-bold text-[#2d3e50] mb-6 flex items-center gap-3 border-b-2 border-slate-100 pb-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center"><Sun size={20} /></div>
                      Duurzaamheid & Ligging <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-1 rounded-full ml-2 font-bold tracking-wider no-print">MOCK DATA</span>
                    </h3>
                    <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100/50 rounded-3xl p-8 shadow-sm">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <h4 className="font-black text-[#2d3e50] text-xl">Zonligging: Zuid-West</h4>
                          <p className="text-sm font-medium text-slate-600 mt-2 max-w-md">Ideaal voor zonliefhebbers en biedt het hoogste rendement voor zonnepanelen op deze breedtegraad.</p>
                        </div>
                        <div className="text-6xl drop-shadow-sm">☀️</div>
                      </div>
                      <div className="grid grid-cols-2 gap-6 mt-6">
                        <div className="bg-white/80 backdrop-blur-sm p-5 rounded-2xl shadow-sm border border-white">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Zonuren per jaar</p>
                          <p className="text-2xl font-black text-[#e67e22] mt-2">1.650 uur</p>
                        </div>
                        <div className="bg-white/80 backdrop-blur-sm p-5 rounded-2xl shadow-sm border border-white">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Zonnepanelen Potentie</p>
                          <p className="text-2xl font-black text-[#58b19f] mt-2">Zeer Hoog</p>
                        </div>
                      </div>
                    </div>
                  </section>
                  
                  {/* Footer */}
                  <div className="pt-16 pb-8 text-center print-only">
                    <div className="inline-block border-t-2 border-slate-200 pt-6">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">WoonWens Client Management System</p>
                      <p className="text-[10px] font-medium text-slate-400 mt-2 max-w-lg mx-auto">Dit rapport is gegenereerd middels geautomatiseerde dataservices. Aan de in dit rapport vermelde (gesimuleerde) gegevens kunnen geen rechten worden ontleend.</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Bottom Navigation Bar – mobile only */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#141e2b] border-t border-slate-700 flex items-stretch z-40 bottom-nav-safe">
          <BottomNavItem view="nieuwste" icon={Home} label="Nieuwst" />
          <BottomNavItem view="matches" icon={MatchIcon} label="Matches" />
          <BottomNavItem view="manager" icon={ClipboardList} label="Manager" />
          <BottomNavItem view="klanten" icon={UserPlus} label="Klanten" />
          <BottomNavItem view="blog-post-maker" icon={PenTool} label="Blog" />
          <BottomNavItem view="database" icon={Database} label="DB" />
          <BottomNavItem view="tasks" icon={CheckSquare} label="Taken" />
          <button
            onClick={() => setActiveView('stable')}
            className={`flex flex-col items-center justify-center flex-1 py-2 gap-1 transition-all duration-200 ${
              activeView === 'stable' ? 'text-red-500' : 'text-red-500 hover:text-red-400'
            }`}
          >
            <Heart size={22} className="fill-red-500 text-red-500 animate-pulse" strokeWidth={1.5} />
            <span className="text-[9px] font-bold uppercase tracking-wider leading-none">Stabiel</span>
          </button>
          <button
            onClick={() => signOut(auth)}
            className="flex flex-col items-center justify-center flex-1 py-2 gap-1 transition-all duration-200 text-slate-500 hover:text-red-400"
          >
            <LogIn size={22} className="rotate-180" strokeWidth={1.5} />
            <span className="text-[9px] font-bold uppercase tracking-wider leading-none">Uitlog</span>
          </button>
        </nav>
      </main>
    </div>
  );
}
