#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');

const argv = require('minimist')(process.argv.slice(2));
const apiBase = argv.api || process.env.API_BASE || 'http://127.0.0.1:3000';
const apiKey = argv.key || process.env.CAFE_API_KEY;
const ttl = Number(argv.ttl || 60);
// optional prefix to avoid phone scanners detecting a raw number
const prefix = typeof argv.prefix === 'string' ? argv.prefix : (argv.p ? argv.p : 'STAMP:');

if (!apiKey) {
  console.error('Missing API key. Set CAFE_API_KEY env or pass --key');
  process.exit(2);
}

(async function main(){
  try {
    const url = apiBase.replace(/\/$/,'') + '/qr/issue';
    const body = JSON.stringify({ ttl });
    const fetchRes = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey }, body });
    if (!fetchRes.ok) {
      const txt = await fetchRes.text();
      throw new Error(`API error ${fetchRes.status}: ${txt}`);
    }
    const data = await fetchRes.json();
    console.log('Issued QR payload:', data);
    const outJson = path.resolve(__dirname, '..', 'data', 'last-qr.json');
    fs.mkdirSync(path.dirname(outJson), { recursive: true });
    fs.writeFileSync(outJson, JSON.stringify(data, null, 2));
    console.log('Saved payload to', outJson);

  const payload = JSON.stringify({ cafeId: data.cafeId, nonce: data.nonce, expires: data.expires });
  const full = prefix + payload;
  const enc = encodeURIComponent(full);
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${enc}&size=400x400`;
    const outPng = path.resolve(__dirname, '..', 'tmp-qr.png');

    await new Promise((resolve, reject)=>{
      const file = fs.createWriteStream(outPng);
      https.get(qrUrl, (res)=>{
        if (res.statusCode !== 200) return reject(new Error('QR server responded ' + res.statusCode));
        res.pipe(file);
        file.on('finish', ()=>{ file.close(resolve); });
      }).on('error', reject);
    });
    console.log('Saved QR PNG to', outPng);
    console.log('Open it with your image viewer or scan with your phone.');
  } catch (err) {
    console.error('Failed to issue QR:', err);
    process.exit(1);
  }
})();
