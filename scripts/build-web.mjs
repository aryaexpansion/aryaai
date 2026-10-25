// Web dosyalarını Capacitor'ın paketleyeceği www/ klasörüne kopyalar.
import { rmSync, mkdirSync, cpSync } from 'node:fs';

const FILES = ['index.html', 'app.js', 'arya-mind.js', 'style.css'];

rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of FILES) cpSync(f, `www/${f}`);
console.log('www/ hazır:', FILES.join(', '));
