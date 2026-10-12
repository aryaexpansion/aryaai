# CryptoBot — Binance Perp Sinyal Radarı (Windows)

> **Karar destek aracıdır, trade botu DEĞİLDİR.** Emir göndermez, API key kullanmaz;
> yalnızca Binance public API'sinden veri okur.

## Kurulum (Windows 10/11)

1. **Python 3.10+** kurulu değilse: <https://www.python.org/downloads/> — kurulumda
   **"Add python.exe to PATH"** kutusunu işaretle.
2. Bu `cryptobot` klasörünü bilgisayarına indir (GitHub → branch `claude/friendly-clarke-wpq8ot`
   → **Code → Download ZIP**, sonra ZIP'i aç).
3. `cryptobot` klasöründe adres çubuğuna `powershell` yazıp Enter'a bas, açılan pencerede:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

Script şunları yapar:

| Adım | Ne yapar |
|---|---|
| 1 | `%USERPROFILE%\CryptoBot\` klasörünü oluşturur, scripti kopyalar |
| 2 | `.venv` oluşturur, `ccxt pandas numpy requests` kurar |
| 3 | Syntax + import kontrolü |
| 4 | Görev Zamanlayıcı'ya `CryptoBot-DashboardServer` görevini ekler: oturum açılınca başlar, kapanırsa 5 dk içinde yeniden başlar (macOS'taki `RunAtLoad` + `KeepAlive` karşılığı). `pythonw.exe` ile çalışır, konsol penceresi açmaz |
| 5 | Server'ı başlatır, `/api/status` (JSON) ve `/api/scan` (`started`) test eder |
| 6 | Masaüstüne **Perp Sinyal Radari** kısayolu koyar |

Yönetici yetkisi gerekmez. Server yalnızca `127.0.0.1`'e bağlanır (dışarıdan erişilemez).

**~5–10 dakika sonra** tarayıcıda <http://localhost:8765/> aç ve yer imi ekle.

## Kullanım

- **Yeniden Tara** butonu → `/api/scan` tetikler, ilerleme gösterir, bitince sayfa yenilenir.
- Sayfa 10 dk'da bir yenilenir; veri 60 dk'dan eskiyse açılışta otomatik tarama başlar.
- Her tarama sonunda Windows bildirimi gelir.
- Çıktılar `%USERPROFILE%\CryptoBot\`: `dashboard.html`, `dashboard_summary.md`, `scan_results.json`, `server.log`, `server.err`.

Elle komutlar (`%USERPROFILE%\CryptoBot` içinde):

```powershell
.\.venv\Scripts\python.exe backtest_perp_scanner.py --mode scan --limit 50
.\.venv\Scripts\python.exe backtest_perp_scanner.py --mode dashboard
.\.venv\Scripts\python.exe backtest_perp_scanner.py --mode backtest --engine v2 --days 365 --limit 30
.\.venv\Scripts\python.exe backtest_perp_scanner.py --mode backtest --engine v1 --symbols BTC,ETH,SOL
```

Kaldırma: `powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\CryptoBot\uninstall.ps1"`

## Sinyal motoru v2 (6 kategori, net skor ±6)

| # | Kategori | Long (+1) | Short (−1) |
|---|---|---|---|
| 1 | Trend — SuperTrend(ATR10, ×3) | yukarı | aşağı |
| 2 | Momentum — RSI(14) eşik + 14-bar RSI divergence | RSI<30 / bull-div | RSI>70 / bear-div |
| 3 | Money flow — CVD divergence (taker buy) | bull-div | bear-div |
| 4 | Funding (yıllık) | < −10% | > +50% |
| 5 | OI 24s buildup | OI ≥ +5% & fiyat ≥ +1% | OI ≥ +5% & fiyat ≤ −1% |
| 6 | Mean reversion — Bollinger(20,2) | alt band altı | üst band üstü |

**Rejim filtresi:** BTC günlük kapanış EMA200 altındaysa pozitif skorlar ×0.5. `raw_net` (filtresiz) ve
`net` (filtreli) ayrı tutulur. |net| ≥ 3 → "güçlü".

**Funding harvest:** pozitif funding + spot eşleniği + perp hacim ≥ 20M$ + spot hacim ≥ 5M$; son 30 günlük
funding geçmişinden stabilite = pozitif% / (1 + std/ort); skor = 30g ort. yıllık funding × stabilite; ilk 15.

## ⚠️ Uyarı

365 günlük backtest'te Sharpe ≈ **−0.7** (negatif). Sinyaller tek başına alfa garantisi vermez.

- Her sinyali bir paper-trade defterine yaz (Notion/Excel)
- 5–10 gün sonra fiyatı kontrol et
- 30+ trade örneklemi topladıktan sonra hit-rate ölç
- **%55'in altındaysa otomatik emir verme** — sinyalleri yalnızca "buna bak" radarı olarak kullan

Not: Binance bazı bölgelerden (ör. ABD) futures API erişimini engeller (HTTP 451). Bu durumda `server.err`'de görünür.
