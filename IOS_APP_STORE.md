# ARYA AI — App Store yayın rehberi

iOS uygulaması, mevcut web uygulamasını [Capacitor](https://capacitorjs.com) ile saran
`ios/` Xcode projesidir. Bundle ID: `com.aryaexpansion.aryaai` (Android ile aynı).

## 1. Bir kerelik hazırlık (sizin yapmanız gerekenler)

1. **Apple Developer Program** üyeliği (yıllık 99 USD): https://developer.apple.com/programs/
2. **App Store Connect → Uygulamalar → +** ile yeni uygulama oluşturun,
   Bundle ID olarak `com.aryaexpansion.aryaai` seçin.
3. **App Store Connect → Kullanıcılar ve Erişim → Entegrasyonlar → App Store Connect API**
   bölümünden "App Manager" yetkili bir anahtar oluşturun, `.p8` dosyasını indirin.
4. GitHub deposunda **Settings → Secrets and variables → Actions** altına ekleyin:

   | Secret | Değer |
   |---|---|
   | `APPLE_TEAM_ID` | developer.apple.com → Membership'teki 10 haneli Team ID |
   | `ASC_KEY_ID` | API anahtarının Key ID'si |
   | `ASC_ISSUER_ID` | API sayfasındaki Issuer ID |
   | `ASC_KEY_P8` | İndirilen `.p8` dosyasının tüm içeriği |

## 2. Derleme ve yükleme (Mac gerekmez)

GitHub → **Actions → "iOS → TestFlight" → Run workflow**. İş akışı macOS sunucusunda
derler, otomatik imzalar ve App Store Connect'e yükler. Build birkaç dakika sonra
TestFlight'ta görünür; oradan "İncelemeye Gönder" diyebilirsiniz.

Mac'iniz varsa yerelde: `npm ci && npm run ios:sync && npm run ios:open`, ardından
Xcode'da **Product → Archive → Distribute App**.

## 3. İncelemeye göndermeden önce eksikler

- **Uygulama simgesi:** `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`
  şu an Capacitor'ın varsayılan simgesi. 1024×1024, saydamlıksız ARYA logosuyla değiştirin
  (ya da `assets/icon.png` koyup `npx capacitor-assets generate --ios` çalıştırın).
- **Ekran görüntüleri:** 6.9" iPhone (1320×2868) en az 3 adet.
- **Gizlilik politikası URL'si** (zorunlu) — ör. `https://aryaexpansion.com/privacy`.
  Uygulama verileri cihazda tutar, sohbetler kullanıcının kendi anahtarıyla OpenAI'ye gider;
  App Privacy formunu buna göre doldurun.
- **Yaş derecelendirmesi:** yapay zekâ ile serbest içerik üretimi olduğu için anketi dikkatle doldurun.
- **İnceleme notu:** "Uygulama hesap gerektirmeden çalışır; GPT özellikleri için kullanıcı
  kendi OpenAI API anahtarını Ayarlar'dan girer." gibi bir not ve gerekirse test anahtarı.

## 4. iOS sürümünde yapılan uyum değişiklikleri

Apple'ın ret sebebi sayacağı şeyler yalnızca iOS'ta gizlenir (`.platform-ios .hide-on-ios`):

- Google Play üzerinden **Pro satın alma** butonu/rozetleri ve linkleri (Kural 3.1.1:
  dijital içerik satışı yalnızca Apple In-App Purchase ile yapılabilir). iOS'ta günlük
  ücretsiz kredi devam eder; Pro için ileride StoreKit/IAP eklenmesi gerekir.
- **"Google ile Devam Et"** butonu — gerçek bir Google girişi yapmıyor (sahte kullanıcı
  oluşturuyor), inceleme bunu yanıltıcı/çalışmayan özellik sayar (Kural 2.1).
- Info.plist'e mikrofon / konuşma tanıma izin açıklamaları ve şifreleme beyanı eklendi.
- Şimdilik yalnızca iPhone hedeflendi (iPad ekran görüntüsü/test yükü olmasın diye).
