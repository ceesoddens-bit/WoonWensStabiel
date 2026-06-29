const fs = require('fs');
const match = JSON.parse(fs.readFileSync('fetch_matches.json'))?.matches?.[1];
const analyse = match.reason;
console.log("Analyse snippet:", analyse.substring(0, 300));
const regex = /(?:\d+\))\s+([^:]+):\s*(?:match\s*)?(.+?)\s*—\s*(.+?)(?=\s+(?:\d+\))|$)/g;
let m;
while ((m = regex.exec(analyse)) !== null) {
  console.log("Label:", m[1].trim());
  console.log("House:", m[2].trim());
  console.log("Status:", m[3].trim());
}
