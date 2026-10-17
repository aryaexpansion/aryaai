# Arya Live Agent

Arya Live Music için operasyon ajanı. Cloudflare Workers üzerinde çalışır, ana uygulamayla aynı D1 veritabanını kullanır. Yapay zekâ olarak Claude API kullanılır.

| Modül | Ne yapar | Onay gerektiren |
|---|---|---|
| **Destek (ticket)** | Talebi okur, kullanıcının hesabını, ödemelerini ve jeton hareketlerini kontrol eder, Türkçe yanıt verir, kategorilere ayırır, gerekirse insana devreder | Jeton telafisi |
| **Canlı yayın** | Stream webhook'larıyla yayın açılışını ve kapanışını takip eder; şikâyet yoğunluğunu ve 12 saati aşan yayınları izler | Yayını engelleme |
| **Ödeme ve jeton** | Her 5 dakikada bekleyen ödemeleri, ödendiği halde yüklenmeyen jetonları, çift yüklemeleri, büyük aktarımları ve bakiye tutarsızlıklarını arar | — (yalnızca uyarı) |
| **Raporlama** | Her gece TR saatiyle 00:00'da günlük rapor ve Türkçe özet üretir | — |
| **Admin API** | Özet ekranı, ticket yönetimi, onay kuyruğu, uyarılar, raporlar, denetim kaydı | — |

**Ajan para ya da jeton hareketini kendi başına yapmaz.** Telafi ve engelleme işlemleri onay kuyruğuna düşer. Admin onaylayınca işlem çalışır. Her adım `audit_log` tablosuna yazılır.

## Kurulum

```bash
cd arya-live-agent
npm install
npx wrangler login

# 1) wrangler.toml içindeki database_id alanına D1 kimliğinizi yazın.

# 2) Tablolar
#    Ana tablolarınız (users, payments, coin_ledger, streams, stream_reports)
#    henüz yoksa schema/core.sql dosyasını çalıştırın. Varsa ÇALIŞTIRMAYIN;
#    alan adlarını karşılaştırıp src/*.js içindeki sorguları uyarlayın.
npm run db:core      # gerekiyorsa
npm run db:agent     # ajan tabloları (her durumda)

# 3) Gizli anahtarlar (her biri ayrı ayrı sorulur)
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_STREAM_TOKEN        # yalnızca "Stream: Edit" yetkili token
npx wrangler secret put STREAM_WEBHOOK_SECRET  # uzun, rastgele bir değer
npx wrangler secret put INTERNAL_TOKEN         # uzun, rastgele bir değer
npx wrangler secret put ADMIN_TOKEN            # uzun, rastgele bir değer

# 4) Yayına al
npm run deploy
```

Rastgele değer üretmek için `openssl rand -hex 32` komutunu kullanabilirsiniz.

### Canlı yayın bildirimleri

Cloudflare panelinde **Notifications → Destinations → Webhooks** bölümüne `https://<worker-adresi>/webhooks/stream` adresini ekleyin. Gizli değer (secret) olarak `STREAM_WEBHOOK_SECRET` ile aynı değeri girin. Ardından **Stream Live Input** bildirimi oluşturup bu hedefe bağlayın.

> Webhook içeriği `data.input_id` ve `data.event_type` (`live_input.connected`, `live_input.disconnected`, `live_input.errored`) alanlarıyla okunur, gizli değer `cf-webhook-auth` başlığından doğrulanır. Bu ayrıntıları Cloudflare belgesiyle (developers.cloudflare.com/stream/stream-live/webhooks) bir kez karşılaştırın. Webhook kaçırılsa bile 5 dakikalık kontrol yayın durumunu Stream API'den doğrular.

## Ana uygulamayla bağlantı

Kullanıcılar bu servisle **doğrudan konuşmaz**. aryalive.tr kullanıcıyı kendi oturumuyla doğrular, ardından isteği bu servise iletir:

```
Authorization: Bearer <INTERNAL_TOKEN>
X-User-Id: <doğrulanmış kullanıcı id>
```

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/internal/tickets` | Kullanıcının talepleri |
| POST | `/internal/tickets` | `{subject, body}`: yeni talep; ajan arka planda yanıtlar |
| GET | `/internal/tickets/:id` | Talep ve mesajlar (iç notlar hariç) |
| POST | `/internal/tickets/:id/messages` | `{body}`: kullanıcı yanıtı |

Admin paneli şu başlıkları gönderir:

```
Authorization: Bearer <ADMIN_TOKEN>
X-Admin-User: <admin kullanıcı adı>
```

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/admin/dashboard` | Açık talepler, bekleyen onaylar, uyarılar, canlı yayın sayısı, bugünkü ciro |
| GET | `/admin/tickets?status=waiting_admin` | Talep listesi |
| GET | `/admin/tickets/:id` | Talep, iç notlar dahil |
| POST | `/admin/tickets/:id/messages` | `{body, internal}`: yanıt ya da iç not. Yanıtlayan admin talebi üstlenir; ajan o talepte artık yanıt vermez |
| POST | `/admin/tickets/:id/assign` | `{assignee}`: `null` gönderilirse talep ajana geri döner |
| POST | `/admin/tickets/:id/status` | `{status}` |
| GET | `/admin/approvals?status=pending` | Onay kuyruğu |
| POST | `/admin/approvals/:id/approve` · `/reject` | `{note}` |
| GET | `/admin/alerts` · POST `/admin/alerts/:id/ack` | Uyarılar |
| GET | `/admin/reports` · POST `/admin/reports/run` | `{date: "2026-10-16"}` |
| GET | `/admin/audit` | Denetim kaydı |

`ADMIN_TOKEN` yalnızca admin panelinin **sunucu tarafında** durmalı, tarayıcıya gönderilmemeli.

## Ödeme akışı için kritik kurallar

Ajan ödemeleri izler ama jeton yüklemesini ana uygulamanın ödeme kodu yapar. O kodda şu kurallar şart:

1. **Jetonu yalnızca bankanın sunucudan sunucuya yaptığı bildirimde (callback) yükleyin.** Kullanıcının "işlem tamamlandı" sayfasına dönmesi ödeme kanıtı değildir; o adres elle de açılabilir.
2. Callback'teki **hash/imzayı** bankanın verdiği gizli anahtarla doğrulayın. Tutarı ve sipariş numarasını kendi kaydınızla karşılaştırın.
3. Yüklemeyi tek bir D1 `batch` içinde yapın: `payments.status='paid'`, `credited_at`, `coin_ledger` kaydı ve `users.coin_balance` güncellemesi. `UPDATE payments ... WHERE status='pending'` koşulunu kullanın; böylece banka bildirimi iki kez gelse bile jeton bir kez yüklenir.
4. Her jeton hareketini `coin_ledger` tablosuna yazın. Ajanın bakiye tutarsızlığı kontrolü bu deftere dayanır.

## Yerel test

```bash
cp .dev.vars.example .dev.vars   # değerleri doldurun
npx wrangler d1 execute aryalive --local --file=schema/core.sql
npx wrangler d1 execute aryalive --local --file=schema/agent.sql
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"   # 5 dakikalık kontrolü elle çalıştırır
```
