#!/usr/bin/env node
/**
 * scripts/translate-rebuild-kit-locales.js
 * ------------------------------------------------------------
 * Inject native translations for the CALQIX Rebuild Kit cart
 * banner + picker modal (`cart.rebuild_kit_picker.*`) and the
 * mobile-collapsible addons block (`calqix_cart.*`) into every
 * locale file under `locales/`.
 *
 * Rules:
 *   - Never rename existing keys. Only read the file, merge new
 *     keys in-place, and re-serialise.
 *   - If `cart.rebuild_kit_picker` is missing, insert the full
 *     translated block.
 *   - If `calqix_cart` is missing, insert the full translated
 *     block. If it already exists, only add MISSING keys so we
 *     don't clobber merchant-tuned copy.
 *   - Preserve leading comment headers if present.
 *   - 2-space indent, trailing newline, UTF-8 no BOM.
 *
 * Brand names stay untranslated everywhere: OralBiome,
 * FlowCore, Rebuild Kit, CALQIX. Numerals (30%, 80) stay
 * numeric. The `·` dot separator and the `→` editor arrow are
 * preserved literally.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.resolve(__dirname, '..', 'locales');

/* ------------------------------------------------------------
 * Translation matrix
 * ------------------------------------------------------------
 * Each locale object has two blocks. We intentionally keep the
 * exact same key set as `en.default.json` so the liquid
 * fallback chain (setting → locale → hard-coded EN) stays
 * deterministic.
 */

const T = {
  ar: {
    rebuild_kit_picker: {
      banner_label: 'وفّر 30%',
      banner_title: 'أكمل طقم Rebuild Kit',
      banner_sub: 'اجمع OralBiome مع لون FlowCore واحصل على خصم 30%.',
      combi_label: 'باقة Rebuild Kit · خصم 30%',
      modal_title: 'اختر لون FlowCore',
      modal_sub: 'باقة Rebuild Kit توفّر لك 30% تلقائياً عند الدفع.',
      cta: 'أضف إلى الطقم',
      rrp: 'السعر الموصى به',
      bundle_price_suffix: 'مع Rebuild Kit',
      empty: 'لم يتم إعداد ألوان FlowCore بعد. قم بتعيين مجموعة في Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'يتم تطبيق الخصم تلقائياً عند الدفع.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'اطلب بقيمة ',
      free_shipping_text_suffix: ' إضافية للحصول على شحن مجاني!',
      free_shipping_success: 'لقد فتحت الشحن المجاني!',
      urgency_text: 'منتج رائج اليوم. اطلب الآن قبل نفاد الكمية.',
      addons_heading: 'دائماً في متناول اليد',
      addon_1_title: 'حقيبة سفر',
      addon_1_text: 'احمِ جهاز FlowCore أثناء السفر.',
      addon_2_title: 'دعم أولوية',
      addon_2_text: 'احصل على دعم وإرشاد مباشر بعد الشراء.',
      addon_2_price: 'مشمول في الخطة المميزة',
      addon_add: 'أضف',
      addon_added: 'تمت الإضافة',
      addon_in_use: 'قيد الاستخدام',
      addon_sold_out: 'نفدت الكمية',
      addon_view: 'عرض',
      total_saved: 'إجمالي التوفير',
      taxes_duties: 'الضرائب والرسوم مشمولة، يتم احتساب الشحن عند الدفع.',
      trust_text: 'دفع آمن · إرجاع خلال 30 يوماً · شحن سريع'
    }
  },

  'bg-BG': {
    rebuild_kit_picker: {
      banner_label: 'СПЕСТИ 30%',
      banner_title: 'Комплектувай своя Rebuild Kit',
      banner_sub: 'Комбинирай OralBiome с цвят FlowCore и получи 30% отстъпка.',
      combi_label: 'Rebuild Kit комплект · 30% отстъпка',
      modal_title: 'Избери своя цвят FlowCore',
      modal_sub: 'Твоят Rebuild Kit комплект спестява 30% автоматично при плащане.',
      cta: 'Добави в комплекта',
      rrp: 'ПЦД',
      bundle_price_suffix: 'с Rebuild Kit',
      empty: 'Все още няма конфигурирани цветове FlowCore. Задай колекция в Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Отстъпката се прилага автоматично при плащане.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'Добави още ',
      free_shipping_text_suffix: ' за БЕЗПЛАТНА доставка!',
      free_shipping_success: 'Отключи БЕЗПЛАТНА доставка!',
      urgency_text: 'Популярен продукт днес. Поръчай сега, за да не го изпуснеш.',
      addons_heading: 'ВИНАГИ ПОД РЪКА',
      addon_1_title: 'Пътна чантичка',
      addon_1_text: 'Защити своя FlowCore по време на път.',
      addon_2_title: 'Приоритетна поддръжка',
      addon_2_text: 'Получи директна поддръжка и съвети след покупка.',
      addon_2_price: 'Включено в премиум плана',
      addon_add: 'Добави',
      addon_added: 'Добавено',
      addon_in_use: 'В употреба',
      addon_sold_out: 'Изчерпано',
      addon_view: 'Виж',
      total_saved: 'Общо спестено',
      taxes_duties: 'Данъци и мита включени, доставката се изчислява при плащане.',
      trust_text: 'Сигурно плащане · 30 дни връщане · Бърза доставка'
    }
  },

  cs: {
    rebuild_kit_picker: {
      banner_label: 'UŠETŘI 30 %',
      banner_title: 'Dokonči svůj Rebuild Kit',
      banner_sub: 'Spoj svůj OralBiome s barvou FlowCore a ušetři 30 %.',
      combi_label: 'Rebuild Kit balíček · sleva 30 %',
      modal_title: 'Vyber si barvu FlowCore',
      modal_sub: 'Tvůj Rebuild Kit balíček automaticky šetří 30 % při platbě.',
      cta: 'Přidat do sady',
      rrp: 'Doporučená cena',
      bundle_price_suffix: 's Rebuild Kit',
      empty: 'Zatím žádné barvy FlowCore. Nastav kolekci v Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Sleva se použije automaticky při platbě.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'Utraťte ještě ',
      free_shipping_text_suffix: ' pro DOPRAVU ZDARMA!',
      free_shipping_success: 'Odemkli jste DOPRAVU ZDARMA!',
      urgency_text: 'Dnes populární produkt. Objednejte, než bude pryč.',
      addons_heading: 'VŽDY PO RUCE',
      addon_1_title: 'Cestovní pouzdro',
      addon_1_text: 'Chraňte svůj FlowCore během cestování.',
      addon_2_title: 'Prioritní podpora',
      addon_2_text: 'Získejte přímou podporu a pomoc po nákupu.',
      addon_2_price: 'Zahrnuto v premium plánu',
      addon_add: 'Přidat',
      addon_added: 'Přidáno',
      addon_in_use: 'V používání',
      addon_sold_out: 'Vyprodáno',
      addon_view: 'Zobrazit',
      total_saved: 'Celkem ušetřeno',
      taxes_duties: 'Daně a cla jsou zahrnuty, doprava se vypočítá při platbě.',
      trust_text: 'Bezpečná platba · 30 dní na vrácení · Rychlé doručení'
    }
  },

  da: {
    rebuild_kit_picker: {
      banner_label: 'SPAR 30 %',
      banner_title: 'Fuldfør dit Rebuild Kit',
      banner_sub: 'Kombiner din OralBiome med en FlowCore farve og spar 30 %.',
      combi_label: 'Rebuild Kit bundle · 30 % rabat',
      modal_title: 'Vælg din FlowCore farve',
      modal_sub: 'Dit Rebuild Kit bundle sparer automatisk 30 % ved kassen.',
      cta: 'Føj til kit',
      rrp: 'Vejl. pris',
      bundle_price_suffix: 'med Rebuild Kit',
      empty: 'Ingen FlowCore farver er sat op. Vælg en kollektion i Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Rabatten anvendes automatisk ved kassen.'
    }
    // calqix_cart already translated in da.json — skip
  },

  el: {
    rebuild_kit_picker: {
      banner_label: 'ΕΞΟΙΚΟΝΟΜΗΣΕ 30%',
      banner_title: 'Ολοκλήρωσε το Rebuild Kit σου',
      banner_sub: 'Συνδύασε το OralBiome με ένα χρώμα FlowCore και κέρδισε 30% έκπτωση.',
      combi_label: 'Πακέτο Rebuild Kit · 30% έκπτωση',
      modal_title: 'Επίλεξε το χρώμα FlowCore',
      modal_sub: 'Το πακέτο Rebuild Kit εξοικονομεί αυτόματα 30% στο ταμείο.',
      cta: 'Προσθήκη στο kit',
      rrp: 'ΠΛΤ',
      bundle_price_suffix: 'με Rebuild Kit',
      empty: 'Δεν έχουν ρυθμιστεί χρώματα FlowCore. Όρισε μια συλλογή στο Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Η έκπτωση εφαρμόζεται αυτόματα στο ταμείο.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'Ξόδεψε ακόμα ',
      free_shipping_text_suffix: ' για ΔΩΡΕΑΝ αποστολή!',
      free_shipping_success: 'Ξεκλείδωσες ΔΩΡΕΑΝ αποστολή!',
      urgency_text: 'Δημοφιλές προϊόν σήμερα. Παράγγειλε τώρα για να μην το χάσεις.',
      addons_heading: 'ΠΑΝΤΑ ΠΡΟΧΕΙΡΑ',
      addon_1_title: 'Θήκη ταξιδιού',
      addon_1_text: 'Προστάτεψε το FlowCore στα ταξίδια.',
      addon_2_title: 'Υποστήριξη προτεραιότητας',
      addon_2_text: 'Πάρε άμεση υποστήριξη και καθοδήγηση μετά την αγορά.',
      addon_2_price: 'Περιλαμβάνεται στο premium πλάνο',
      addon_add: 'Προσθήκη',
      addon_added: 'Προστέθηκε',
      addon_in_use: 'Σε χρήση',
      addon_sold_out: 'Εξαντλημένο',
      addon_view: 'Προβολή',
      total_saved: 'Συνολική εξοικονόμηση',
      taxes_duties: 'Φόροι και δασμοί περιλαμβάνονται, μεταφορικά υπολογίζονται στο ταμείο.',
      trust_text: 'Ασφαλής αγορά · Επιστροφές 30 ημερών · Γρήγορη αποστολή'
    }
  },

  es: {
    // rebuild_kit_picker already present — skip
    calqix_cart: {
      free_shipping_text_prefix: 'Añade ',
      free_shipping_text_suffix: ' más para ENVÍO GRATIS!',
      free_shipping_success: '¡Has desbloqueado el ENVÍO GRATIS!',
      urgency_text: 'Producto popular hoy. Pide ahora para no perdértelo.',
      addons_heading: 'SIEMPRE A MANO',
      addon_1_title: 'Estuche de viaje',
      addon_1_text: 'Protege tu FlowCore durante los viajes.',
      addon_2_title: 'Soporte prioritario',
      addon_2_text: 'Recibe soporte y orientación directa tras la compra.',
      addon_2_price: 'Incluido en el plan premium',
      addon_add: 'Añadir',
      addon_added: 'Añadido',
      addon_in_use: 'En uso',
      addon_sold_out: 'Agotado',
      addon_view: 'Ver',
      total_saved: 'Total ahorrado',
      taxes_duties: 'Impuestos y aranceles incluidos, gastos de envío calculados en el pago.',
      trust_text: 'Pago seguro · Devoluciones en 30 días · Envío rápido'
    }
  },

  fi: {
    rebuild_kit_picker: {
      banner_label: 'SÄÄSTÄ 30 %',
      banner_title: 'Viimeistele Rebuild Kit',
      banner_sub: 'Yhdistä OralBiome FlowCore-väriin ja säästä 30 %.',
      combi_label: 'Rebuild Kit -paketti · 30 % alennus',
      modal_title: 'Valitse FlowCore-värisi',
      modal_sub: 'Rebuild Kit -paketti säästää automaattisesti 30 % kassalla.',
      cta: 'Lisää pakettiin',
      rrp: 'Ohjevähittäishinta',
      bundle_price_suffix: 'Rebuild Kitillä',
      empty: 'FlowCore-värejä ei ole vielä asetettu. Valitse kokoelma: Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Alennus lisätään automaattisesti kassalla.'
    }
    // calqix_cart already present — skip
  },

  'hr-HR': {
    rebuild_kit_picker: {
      banner_label: 'UŠTEDI 30%',
      banner_title: 'Upotpuni svoj Rebuild Kit',
      banner_sub: 'Uskladi svoj OralBiome s FlowCore bojom i uštedi 30%.',
      combi_label: 'Rebuild Kit paket · 30% popust',
      modal_title: 'Odaberi svoju FlowCore boju',
      modal_sub: 'Tvoj Rebuild Kit paket automatski štedi 30% na blagajni.',
      cta: 'Dodaj u kit',
      rrp: 'MPC',
      bundle_price_suffix: 's Rebuild Kit',
      empty: 'Još nema postavljenih FlowCore boja. Postavi kolekciju u Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Popust se automatski primjenjuje na blagajni.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'Dodaj još ',
      free_shipping_text_suffix: ' za BESPLATNU dostavu!',
      free_shipping_success: 'Otključao si BESPLATNU dostavu!',
      urgency_text: 'Popularan proizvod danas. Naruči sada prije nego što nestane.',
      addons_heading: 'UVIJEK PRI RUCI',
      addon_1_title: 'Putna torbica',
      addon_1_text: 'Zaštiti svoj FlowCore na putu.',
      addon_2_title: 'Prioritetna podrška',
      addon_2_text: 'Ostvari izravnu podršku i savjete nakon kupnje.',
      addon_2_price: 'Uključeno u premium plan',
      addon_add: 'Dodaj',
      addon_added: 'Dodano',
      addon_in_use: 'U upotrebi',
      addon_sold_out: 'Rasprodano',
      addon_view: 'Prikaži',
      total_saved: 'Ukupno ušteđeno',
      taxes_duties: 'Porezi i carine uključeni, dostava se obračunava pri plaćanju.',
      trust_text: 'Sigurna kupnja · 30 dana povrata · Brza dostava'
    }
  },

  hu: {
    rebuild_kit_picker: {
      banner_label: '30% KEDVEZMÉNY',
      banner_title: 'Fejezd be a Rebuild Kited',
      banner_sub: 'Párosítsd az OralBiome-ot egy FlowCore színnel 30% kedvezményért.',
      combi_label: 'Rebuild Kit csomag · 30% kedvezmény',
      modal_title: 'Válaszd ki a FlowCore színed',
      modal_sub: 'A Rebuild Kit csomagod automatikusan 30%-ot spórol a fizetésnél.',
      cta: 'Hozzáadás a Kithez',
      rrp: 'Ajánlott ár',
      bundle_price_suffix: 'Rebuild Kittel',
      empty: 'Még nincsenek FlowCore színek beállítva. Állíts be egy kollekciót: Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'A kedvezmény automatikusan érvényesül a fizetésnél.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'Költs még ',
      free_shipping_text_suffix: '-t az INGYENES szállításért!',
      free_shipping_success: 'Feloldottad az INGYENES szállítást!',
      urgency_text: 'Ma népszerű termék. Rendeld meg most, mielőtt elfogy.',
      addons_heading: 'MINDIG KÉZNÉL',
      addon_1_title: 'Utazó tok',
      addon_1_text: 'Védd a FlowCore-odat utazás közben.',
      addon_2_title: 'Kiemelt támogatás',
      addon_2_text: 'Kapj közvetlen támogatást és útmutatást a vásárlás után.',
      addon_2_price: 'A prémium csomagban benne van',
      addon_add: 'Hozzáadás',
      addon_added: 'Hozzáadva',
      addon_in_use: 'Használatban',
      addon_sold_out: 'Elfogyott',
      addon_view: 'Megtekintés',
      total_saved: 'Összesen megspórolva',
      taxes_duties: 'Adók és vámok beleértve, a szállítás a fizetésnél számolódik.',
      trust_text: 'Biztonságos fizetés · 30 napos visszaküldés · Gyors szállítás'
    }
  },

  id: {
    rebuild_kit_picker: {
      banner_label: 'HEMAT 30%',
      banner_title: 'Lengkapi Rebuild Kit-mu',
      banner_sub: 'Padukan OralBiome dengan warna FlowCore dan hemat 30%.',
      combi_label: 'Paket Rebuild Kit · diskon 30%',
      modal_title: 'Pilih warna FlowCore-mu',
      modal_sub: 'Paket Rebuild Kit-mu otomatis menghemat 30% saat checkout.',
      cta: 'Tambah ke Kit',
      rrp: 'HET',
      bundle_price_suffix: 'dengan Rebuild Kit',
      empty: 'Belum ada warna FlowCore. Atur koleksi di Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Diskon diterapkan otomatis saat checkout.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'Belanja ',
      free_shipping_text_suffix: ' lagi untuk PENGIRIMAN GRATIS!',
      free_shipping_success: 'Kamu mendapat PENGIRIMAN GRATIS!',
      urgency_text: 'Produk populer hari ini. Pesan sekarang selagi masih ada.',
      addons_heading: 'SELALU BERGUNA',
      addon_1_title: 'Tas perjalanan',
      addon_1_text: 'Lindungi FlowCore-mu saat bepergian.',
      addon_2_title: 'Dukungan prioritas',
      addon_2_text: 'Dapatkan dukungan dan panduan langsung setelah pembelian.',
      addon_2_price: 'Termasuk dalam paket premium',
      addon_add: 'Tambah',
      addon_added: 'Ditambah',
      addon_in_use: 'Digunakan',
      addon_sold_out: 'Habis',
      addon_view: 'Lihat',
      total_saved: 'Total hemat',
      taxes_duties: 'Pajak dan bea sudah termasuk, ongkir dihitung saat checkout.',
      trust_text: 'Checkout aman · Pengembalian 30 hari · Pengiriman cepat'
    }
  },

  it: {
    // rebuild_kit_picker already present — skip
    calqix_cart: {
      free_shipping_text_prefix: 'Aggiungi ',
      free_shipping_text_suffix: ' in più per la SPEDIZIONE GRATUITA!',
      free_shipping_success: 'Hai sbloccato la SPEDIZIONE GRATUITA!',
      urgency_text: 'Prodotto popolare oggi. Ordina ora per non perdertelo.',
      addons_heading: 'SEMPRE UTILE',
      addon_1_title: 'Pochette da viaggio',
      addon_1_text: 'Proteggi il tuo FlowCore in viaggio.',
      addon_2_title: 'Supporto prioritario',
      addon_2_text: "Ricevi supporto e guida diretti dopo l'acquisto.",
      addon_2_price: 'Incluso nel piano premium',
      addon_add: 'Aggiungi',
      addon_added: 'Aggiunto',
      addon_in_use: 'In uso',
      addon_sold_out: 'Esaurito',
      addon_view: 'Vedi',
      total_saved: 'Totale risparmiato',
      taxes_duties: 'Tasse e dazi inclusi, spedizione calcolata al checkout.',
      trust_text: 'Checkout sicuro · Resi entro 30 giorni · Spedizione veloce'
    }
  },

  ja: {
    rebuild_kit_picker: {
      banner_label: '30%オフ',
      banner_title: 'Rebuild Kitを完成させる',
      banner_sub: 'OralBiomeとFlowCoreカラーを組み合わせて30%オフ。',
      combi_label: 'Rebuild Kitバンドル · 30%オフ',
      modal_title: 'FlowCoreのカラーを選ぶ',
      modal_sub: 'Rebuild Kitバンドルならお会計時に自動で30%オフ。',
      cta: 'キットに追加',
      rrp: '希望小売価格',
      bundle_price_suffix: 'Rebuild Kit込み',
      empty: 'FlowCoreのカラーが未設定です。Theme Editor → CALQIX · Rebuild Kit Bundle でコレクションを指定してください。',
      footer: 'お会計時に割引が自動適用されます。'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'あと ',
      free_shipping_text_suffix: 'で送料無料!',
      free_shipping_success: '送料無料を獲得しました!',
      urgency_text: '本日人気の商品。お早めにご注文を。',
      addons_heading: 'いつでも便利',
      addon_1_title: 'トラベルポーチ',
      addon_1_text: '旅行中もFlowCoreを保護。',
      addon_2_title: '優先サポート',
      addon_2_text: '購入後に直接サポートとガイダンスを受けられます。',
      addon_2_price: 'プレミアムプランに含まれる',
      addon_add: '追加',
      addon_added: '追加済み',
      addon_in_use: '使用中',
      addon_sold_out: '売り切れ',
      addon_view: '見る',
      total_saved: '合計節約額',
      taxes_duties: '税金・関税込み。送料はお会計時に計算されます。',
      trust_text: '安全なお支払い · 30日間返品可 · 迅速な配送'
    }
  },

  ko: {
    rebuild_kit_picker: {
      banner_label: '30% 할인',
      banner_title: 'Rebuild Kit 완성하기',
      banner_sub: 'OralBiome과 FlowCore 색상을 함께하면 30% 할인.',
      combi_label: 'Rebuild Kit 번들 · 30% 할인',
      modal_title: 'FlowCore 색상 선택',
      modal_sub: 'Rebuild Kit 번들은 결제 시 자동으로 30% 절약됩니다.',
      cta: 'Kit에 추가',
      rrp: '권장소비자가',
      bundle_price_suffix: 'Rebuild Kit 포함 시',
      empty: '아직 설정된 FlowCore 색상이 없습니다. Theme Editor → CALQIX · Rebuild Kit Bundle 에서 컬렉션을 설정하세요.',
      footer: '할인은 결제 시 자동 적용됩니다.'
    },
    calqix_cart: {
      free_shipping_text_prefix: '추가로 ',
      free_shipping_text_suffix: ' 구매하면 무료배송!',
      free_shipping_success: '무료배송을 받았습니다!',
      urgency_text: '오늘 인기 상품. 놓치기 전에 주문하세요.',
      addons_heading: '언제나 유용한',
      addon_1_title: '여행용 파우치',
      addon_1_text: '여행 중에도 FlowCore를 보호하세요.',
      addon_2_title: '우선 지원',
      addon_2_text: '구매 후 직접적인 지원과 안내를 받으세요.',
      addon_2_price: '프리미엄 플랜에 포함',
      addon_add: '추가',
      addon_added: '추가됨',
      addon_in_use: '사용 중',
      addon_sold_out: '품절',
      addon_view: '보기',
      total_saved: '총 절약',
      taxes_duties: '세금 및 관세 포함, 배송비는 결제 시 계산됩니다.',
      trust_text: '안전한 결제 · 30일 반품 · 빠른 배송'
    }
  },

  'lt-LT': {
    rebuild_kit_picker: {
      banner_label: 'SUTAUPYK 30%',
      banner_title: 'Užbaik savo Rebuild Kit',
      banner_sub: 'Suderink OralBiome su FlowCore spalva ir sutaupyk 30%.',
      combi_label: 'Rebuild Kit rinkinys · 30% nuolaida',
      modal_title: 'Pasirink savo FlowCore spalvą',
      modal_sub: 'Tavo Rebuild Kit rinkinys automatiškai sutaupo 30% atsiskaitant.',
      cta: 'Pridėti į rinkinį',
      rrp: 'RMK',
      bundle_price_suffix: 'su Rebuild Kit',
      empty: 'FlowCore spalvų dar nesukonfigūruota. Nustatyk kolekciją: Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Nuolaida taikoma automatiškai atsiskaitant.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'Pridėk dar už ',
      free_shipping_text_suffix: ' ir gauk NEMOKAMĄ siuntimą!',
      free_shipping_success: 'Atrakinai NEMOKAMĄ siuntimą!',
      urgency_text: 'Populiari prekė šiandien. Užsisakyk dabar, kol nebuvo išparduota.',
      addons_heading: 'VISADA PRIE RANKOS',
      addon_1_title: 'Kelioninis krepšelis',
      addon_1_text: 'Apsaugok savo FlowCore keliaujant.',
      addon_2_title: 'Prioritetinė pagalba',
      addon_2_text: 'Gauk tiesioginę pagalbą ir patarimus po pirkimo.',
      addon_2_price: 'Įtraukta į premium planą',
      addon_add: 'Pridėti',
      addon_added: 'Pridėta',
      addon_in_use: 'Naudojama',
      addon_sold_out: 'Išparduota',
      addon_view: 'Žiūrėti',
      total_saved: 'Iš viso sutaupyta',
      taxes_duties: 'Mokesčiai ir muitai įskaičiuoti, siuntimas apskaičiuojamas atsiskaitant.',
      trust_text: 'Saugus atsiskaitymas · 30 d. grąžinimas · Greitas pristatymas'
    }
  },

  nb: {
    rebuild_kit_picker: {
      banner_label: 'SPAR 30 %',
      banner_title: 'Fullfør ditt Rebuild Kit',
      banner_sub: 'Kombiner din OralBiome med en FlowCore farge og spar 30 %.',
      combi_label: 'Rebuild Kit pakke · 30 % rabatt',
      modal_title: 'Velg din FlowCore farge',
      modal_sub: 'Rebuild Kit pakken din sparer automatisk 30 % i kassen.',
      cta: 'Legg til i kit',
      rrp: 'Veil. pris',
      bundle_price_suffix: 'med Rebuild Kit',
      empty: 'Ingen FlowCore farger satt opp. Velg en kolleksjon i Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Rabatt anvendes automatisk i kassen.'
    }
    // calqix_cart already present — skip
  },

  pl: {
    rebuild_kit_picker: {
      banner_label: 'OSZCZĘDŹ 30%',
      banner_title: 'Skompletuj swój Rebuild Kit',
      banner_sub: 'Połącz OralBiome z kolorem FlowCore i zyskaj 30% rabatu.',
      combi_label: 'Zestaw Rebuild Kit · 30% rabatu',
      modal_title: 'Wybierz swój kolor FlowCore',
      modal_sub: 'Twój zestaw Rebuild Kit automatycznie oszczędza 30% przy płatności.',
      cta: 'Dodaj do zestawu',
      rrp: 'Sug. cena',
      bundle_price_suffix: 'z Rebuild Kit',
      empty: 'Brak skonfigurowanych kolorów FlowCore. Ustaw kolekcję: Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Rabat stosowany automatycznie przy płatności.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'Kup za jeszcze ',
      free_shipping_text_suffix: ', aby otrzymać DARMOWĄ dostawę!',
      free_shipping_success: 'Odblokowałeś DARMOWĄ dostawę!',
      urgency_text: 'Popularny produkt dzisiaj. Zamów, zanim się wyprzeda.',
      addons_heading: 'ZAWSZE POD RĘKĄ',
      addon_1_title: 'Etui podróżne',
      addon_1_text: 'Chroń swój FlowCore w podróży.',
      addon_2_title: 'Wsparcie priorytetowe',
      addon_2_text: 'Otrzymuj bezpośrednie wsparcie i wskazówki po zakupie.',
      addon_2_price: 'Zawarte w planie premium',
      addon_add: 'Dodaj',
      addon_added: 'Dodano',
      addon_in_use: 'W użyciu',
      addon_sold_out: 'Wyprzedane',
      addon_view: 'Zobacz',
      total_saved: 'Łącznie zaoszczędzono',
      taxes_duties: 'Podatki i cła wliczone, wysyłka liczona przy płatności.',
      trust_text: 'Bezpieczna płatność · Zwroty 30 dni · Szybka dostawa'
    }
  },

  'pt-BR': {
    // rebuild_kit_picker already present — skip
    calqix_cart: {
      free_shipping_text_prefix: 'Adicione ',
      free_shipping_text_suffix: ' para FRETE GRÁTIS!',
      free_shipping_success: 'Você desbloqueou FRETE GRÁTIS!',
      urgency_text: 'Produto popular hoje. Peça agora antes que acabe.',
      addons_heading: 'SEMPRE À MÃO',
      addon_1_title: 'Estojo de viagem',
      addon_1_text: 'Proteja seu FlowCore em viagem.',
      addon_2_title: 'Suporte prioritário',
      addon_2_text: 'Receba suporte direto e orientação após a compra.',
      addon_2_price: 'Incluso no plano premium',
      addon_add: 'Adicionar',
      addon_added: 'Adicionado',
      addon_in_use: 'Em uso',
      addon_sold_out: 'Esgotado',
      addon_view: 'Ver',
      total_saved: 'Total economizado',
      taxes_duties: 'Impostos e taxas incluídos, frete calculado no checkout.',
      trust_text: 'Checkout seguro · Devoluções em 30 dias · Entrega rápida'
    }
  },

  'pt-PT': {
    rebuild_kit_picker: {
      banner_label: 'POUPA 30%',
      banner_title: 'Completa o teu Rebuild Kit',
      banner_sub: 'Combina o teu OralBiome com uma cor FlowCore e poupa 30%.',
      combi_label: 'Pack Rebuild Kit · 30% desconto',
      modal_title: 'Escolhe a tua cor FlowCore',
      modal_sub: 'O teu Pack Rebuild Kit poupa automaticamente 30% no checkout.',
      cta: 'Adicionar ao Kit',
      rrp: 'PVP',
      bundle_price_suffix: 'com Rebuild Kit',
      empty: 'Nenhuma cor FlowCore configurada. Define uma coleção em Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Desconto aplicado automaticamente no checkout.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'Adiciona mais ',
      free_shipping_text_suffix: ' para ENVIO GRATUITO!',
      free_shipping_success: 'Desbloqueaste ENVIO GRATUITO!',
      urgency_text: 'Produto popular hoje. Encomenda agora antes que acabe.',
      addons_heading: 'SEMPRE À MÃO',
      addon_1_title: 'Bolsa de viagem',
      addon_1_text: 'Protege o teu FlowCore em viagem.',
      addon_2_title: 'Suporte prioritário',
      addon_2_text: 'Obtém suporte direto e orientação após a compra.',
      addon_2_price: 'Incluído no plano premium',
      addon_add: 'Adicionar',
      addon_added: 'Adicionado',
      addon_in_use: 'Em uso',
      addon_sold_out: 'Esgotado',
      addon_view: 'Ver',
      total_saved: 'Total poupado',
      taxes_duties: 'Impostos e direitos incluídos, envio calculado no checkout.',
      trust_text: 'Pagamento seguro · Devoluções em 30 dias · Entrega rápida'
    }
  },

  'ro-RO': {
    rebuild_kit_picker: {
      banner_label: 'ECONOMISEȘTE 30%',
      banner_title: 'Completează-ți Rebuild Kit',
      banner_sub: 'Combină OralBiome cu o culoare FlowCore și economisește 30%.',
      combi_label: 'Pachet Rebuild Kit · 30% reducere',
      modal_title: 'Alege culoarea FlowCore',
      modal_sub: 'Pachetul Rebuild Kit economisește automat 30% la checkout.',
      cta: 'Adaugă în kit',
      rrp: 'PVR',
      bundle_price_suffix: 'cu Rebuild Kit',
      empty: 'Nicio culoare FlowCore configurată. Setează o colecție în Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Reducerea se aplică automat la checkout.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'Mai adaugă ',
      free_shipping_text_suffix: ' pentru TRANSPORT GRATUIT!',
      free_shipping_success: 'Ai deblocat TRANSPORTUL GRATUIT!',
      urgency_text: 'Produs popular astăzi. Comandă acum până nu se termină.',
      addons_heading: 'MEREU LA ÎNDEMÂNĂ',
      addon_1_title: 'Husă de voiaj',
      addon_1_text: 'Protejează-ți FlowCore în călătorii.',
      addon_2_title: 'Suport prioritar',
      addon_2_text: 'Primește suport și îndrumare directă după cumpărare.',
      addon_2_price: 'Inclus în planul premium',
      addon_add: 'Adaugă',
      addon_added: 'Adăugat',
      addon_in_use: 'În utilizare',
      addon_sold_out: 'Epuizat',
      addon_view: 'Vezi',
      total_saved: 'Total economisit',
      taxes_duties: 'Taxe și impozite incluse, transport calculat la checkout.',
      trust_text: 'Checkout sigur · Retur 30 zile · Livrare rapidă'
    }
  },

  ru: {
    rebuild_kit_picker: {
      banner_label: 'СКИДКА 30%',
      banner_title: 'Собери свой Rebuild Kit',
      banner_sub: 'Сочетай OralBiome с цветом FlowCore и получи скидку 30%.',
      combi_label: 'Набор Rebuild Kit · скидка 30%',
      modal_title: 'Выбери цвет FlowCore',
      modal_sub: 'Твой набор Rebuild Kit автоматически экономит 30% при оплате.',
      cta: 'Добавить в набор',
      rrp: 'РРЦ',
      bundle_price_suffix: 'с Rebuild Kit',
      empty: 'Цвета FlowCore не настроены. Задай коллекцию в Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Скидка применяется автоматически при оплате.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'Добавь ещё ',
      free_shipping_text_suffix: ' для БЕСПЛАТНОЙ доставки!',
      free_shipping_success: 'Бесплатная доставка разблокирована!',
      urgency_text: 'Популярный товар сегодня. Заказывай, пока есть в наличии.',
      addons_heading: 'ВСЕГДА ПОД РУКОЙ',
      addon_1_title: 'Дорожный чехол',
      addon_1_text: 'Защити свой FlowCore в дороге.',
      addon_2_title: 'Приоритетная поддержка',
      addon_2_text: 'Получи прямую поддержку и советы после покупки.',
      addon_2_price: 'Включено в премиум-план',
      addon_add: 'Добавить',
      addon_added: 'Добавлено',
      addon_in_use: 'Используется',
      addon_sold_out: 'Распродано',
      addon_view: 'Смотреть',
      total_saved: 'Всего сэкономлено',
      taxes_duties: 'Налоги и пошлины включены, доставка рассчитывается при оплате.',
      trust_text: 'Безопасная оплата · Возврат 30 дней · Быстрая доставка'
    }
  },

  'sk-SK': {
    rebuild_kit_picker: {
      banner_label: 'UŠETRI 30 %',
      banner_title: 'Dokonči svoj Rebuild Kit',
      banner_sub: 'Spoj svoj OralBiome s farbou FlowCore a ušetri 30 %.',
      combi_label: 'Balíček Rebuild Kit · 30 % zľava',
      modal_title: 'Vyber si farbu FlowCore',
      modal_sub: 'Tvoj Rebuild Kit balíček automaticky ušetrí 30 % pri platbe.',
      cta: 'Pridať do sady',
      rrp: 'OMC',
      bundle_price_suffix: 's Rebuild Kit',
      empty: 'Žiadne farby FlowCore nie sú nastavené. Zvoľ kolekciu: Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Zľava sa uplatní automaticky pri platbe.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'Nakúp ešte za ',
      free_shipping_text_suffix: ' pre DOPRAVU ZADARMO!',
      free_shipping_success: 'Odomkol si DOPRAVU ZADARMO!',
      urgency_text: 'Dnes obľúbený produkt. Objednaj teraz, kým je skladom.',
      addons_heading: 'VŽDY PO RUKE',
      addon_1_title: 'Cestovné puzdro',
      addon_1_text: 'Chráň svoj FlowCore na cestách.',
      addon_2_title: 'Prioritná podpora',
      addon_2_text: 'Získaj priamu podporu a rady po nákupe.',
      addon_2_price: 'Zahrnuté v premium pláne',
      addon_add: 'Pridať',
      addon_added: 'Pridané',
      addon_in_use: 'V používaní',
      addon_sold_out: 'Vypredané',
      addon_view: 'Zobraziť',
      total_saved: 'Celkovo ušetrené',
      taxes_duties: 'Dane a clá zahrnuté, doprava sa počíta pri platbe.',
      trust_text: 'Bezpečná platba · 30 dní na vrátenie · Rýchle doručenie'
    }
  },

  'sl-SI': {
    rebuild_kit_picker: {
      banner_label: 'PRIHRANI 30 %',
      banner_title: 'Dokončaj svoj Rebuild Kit',
      banner_sub: 'Poveži OralBiome s FlowCore barvo in prihrani 30 %.',
      combi_label: 'Paket Rebuild Kit · 30 % popust',
      modal_title: 'Izberi svojo FlowCore barvo',
      modal_sub: 'Tvoj Rebuild Kit paket samodejno prihrani 30 % ob plačilu.',
      cta: 'Dodaj v komplet',
      rrp: 'PMC',
      bundle_price_suffix: 'z Rebuild Kit',
      empty: 'Barve FlowCore še niso nastavljene. Določi kolekcijo v Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Popust se uporabi samodejno ob plačilu.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'Dodaj še za ',
      free_shipping_text_suffix: ' in prejmi BREZPLAČNO dostavo!',
      free_shipping_success: 'Odklenil si BREZPLAČNO dostavo!',
      urgency_text: 'Danes priljubljen izdelek. Naroči zdaj, preden poide.',
      addons_heading: 'VEDNO PRI ROKI',
      addon_1_title: 'Potovalna torbica',
      addon_1_text: 'Zaščiti svoj FlowCore na poti.',
      addon_2_title: 'Prednostna podpora',
      addon_2_text: 'Prejmi neposredno podporo in nasvete po nakupu.',
      addon_2_price: 'Vključeno v premium paketu',
      addon_add: 'Dodaj',
      addon_added: 'Dodano',
      addon_in_use: 'V uporabi',
      addon_sold_out: 'Razprodano',
      addon_view: 'Prikaži',
      total_saved: 'Skupaj prihranjeno',
      taxes_duties: 'Davki in carine vključeni, poštnina obračunana ob plačilu.',
      trust_text: 'Varno plačilo · 30-dnevna vračila · Hitra dostava'
    }
  },

  sv: {
    rebuild_kit_picker: {
      banner_label: 'SPARA 30 %',
      banner_title: 'Fullborda ditt Rebuild Kit',
      banner_sub: 'Kombinera din OralBiome med en FlowCore färg och spara 30 %.',
      combi_label: 'Rebuild Kit paket · 30 % rabatt',
      modal_title: 'Välj din FlowCore färg',
      modal_sub: 'Ditt Rebuild Kit paket sparar automatiskt 30 % i kassan.',
      cta: 'Lägg till i kit',
      rrp: 'Rek. pris',
      bundle_price_suffix: 'med Rebuild Kit',
      empty: 'Inga FlowCore färger uppsatta. Ställ in en kollektion i Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Rabatten anpassas automatiskt i kassan.'
    }
    // calqix_cart already present — skip
  },

  th: {
    rebuild_kit_picker: {
      banner_label: 'ประหยัด 30%',
      banner_title: 'เติมเต็ม Rebuild Kit ของคุณ',
      banner_sub: 'จับคู่ OralBiome กับสี FlowCore ประหยัด 30%',
      combi_label: 'บันเดิล Rebuild Kit · ลด 30%',
      modal_title: 'เลือกสี FlowCore ของคุณ',
      modal_sub: 'บันเดิล Rebuild Kit ของคุณประหยัด 30% อัตโนมัติตอนชำระเงิน',
      cta: 'เพิ่มลงชุด',
      rrp: 'ราคาแนะนำ',
      bundle_price_suffix: 'กับ Rebuild Kit',
      empty: 'ยังไม่ได้ตั้งค่าสี FlowCore ตั้งค่าคอลเลคชันที่ Theme Editor → CALQIX · Rebuild Kit Bundle',
      footer: 'ส่วนลดถูกปรับใช้อัตโนมัติตอนชำระเงิน'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'ซื้อเพิ่มอีก ',
      free_shipping_text_suffix: ' เพื่อรับส่งฟรี!',
      free_shipping_success: 'ปลดล็อคส่งฟรีแล้ว!',
      urgency_text: 'สินค้ายอดนิยมวันนี้ สั่งเลยก่อนหมด',
      addons_heading: 'หยิบใช้ได้ตลอด',
      addon_1_title: 'กระเป๋าเดินทาง',
      addon_1_text: 'ปกป้อง FlowCore ระหว่างการเดินทาง',
      addon_2_title: 'ซัพพอร์ตพรีเมียม',
      addon_2_text: 'รับคำแนะนำและซัพพอร์ตโดยตรงหลังการซื้อ',
      addon_2_price: 'รวมอยู่ในแผนพรีเมียม',
      addon_add: 'เพิ่ม',
      addon_added: 'เพิ่มแล้ว',
      addon_in_use: 'กำลังใช้งาน',
      addon_sold_out: 'หมดแล้ว',
      addon_view: 'ดู',
      total_saved: 'ประหยัดรวม',
      taxes_duties: 'รวมภาษีและอากร ค่าจัดส่งคำนวณตอนชำระเงิน',
      trust_text: 'ชำระเงินปลอดภัย · คืนสินค้าใน 30 วัน · ส่งเร็ว'
    }
  },

  tr: {
    rebuild_kit_picker: {
      banner_label: '%30 TASARRUF',
      banner_title: "Rebuild Kit'ini Tamamla",
      banner_sub: "OralBiome'u bir FlowCore rengiyle eşleştir ve %30 indirim kazan.",
      combi_label: 'Rebuild Kit paketi · %30 indirim',
      modal_title: 'FlowCore rengini seç',
      modal_sub: 'Rebuild Kit paketin ödeme sırasında otomatik %30 tasarruf sağlar.',
      cta: 'Kite ekle',
      rrp: 'TPSF',
      bundle_price_suffix: 'Rebuild Kit ile',
      empty: 'Henüz FlowCore rengi ayarlanmamış. Bir koleksiyon ayarla: Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'İndirim ödeme sırasında otomatik uygulanır.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'Kargoyu ÜCRETSİZ yapmak için ',
      free_shipping_text_suffix: ' daha ekle!',
      free_shipping_success: 'ÜCRETSİZ KARGO kazandın!',
      urgency_text: 'Bugün popüler ürün. Kaçırmadan şimdi sipariş ver.',
      addons_heading: 'HER ZAMAN YANINDA',
      addon_1_title: 'Seyahat çantası',
      addon_1_text: "FlowCore'unu seyahatte koru.",
      addon_2_title: 'Öncelikli destek',
      addon_2_text: 'Satın aldıktan sonra doğrudan destek ve rehberlik al.',
      addon_2_price: 'Premium planda dahil',
      addon_add: 'Ekle',
      addon_added: 'Eklendi',
      addon_in_use: 'Kullanımda',
      addon_sold_out: 'Tükendi',
      addon_view: 'Görüntüle',
      total_saved: 'Toplam tasarruf',
      taxes_duties: 'Vergi ve harçlar dahil, kargo ödeme sırasında hesaplanır.',
      trust_text: 'Güvenli ödeme · 30 gün iade · Hızlı kargo'
    }
  },

  vi: {
    rebuild_kit_picker: {
      banner_label: 'TIẾT KIỆM 30%',
      banner_title: 'Hoàn thiện Rebuild Kit của bạn',
      banner_sub: 'Kết hợp OralBiome với một màu FlowCore để giảm 30%.',
      combi_label: 'Gói Rebuild Kit · giảm 30%',
      modal_title: 'Chọn màu FlowCore của bạn',
      modal_sub: 'Gói Rebuild Kit tự động tiết kiệm 30% khi thanh toán.',
      cta: 'Thêm vào Kit',
      rrp: 'Giá đề xuất',
      bundle_price_suffix: 'với Rebuild Kit',
      empty: 'Chưa có màu FlowCore. Thiết lập bộ sưu tập tại Theme Editor → CALQIX · Rebuild Kit Bundle.',
      footer: 'Giảm giá áp dụng tự động khi thanh toán.'
    },
    calqix_cart: {
      free_shipping_text_prefix: 'Mua thêm ',
      free_shipping_text_suffix: ' để được MIỄN PHÍ GIAO HÀNG!',
      free_shipping_success: 'Bạn đã mở khóa MIỄN PHÍ GIAO HÀNG!',
      urgency_text: 'Sản phẩm hot hôm nay. Đặt ngay kẻo hết.',
      addons_heading: 'LUÔN HỮU DỤNG',
      addon_1_title: 'Túi du lịch',
      addon_1_text: 'Bảo vệ FlowCore khi di chuyển.',
      addon_2_title: 'Hỗ trợ ưu tiên',
      addon_2_text: 'Nhận hỗ trợ và hướng dẫn trực tiếp sau khi mua.',
      addon_2_price: 'Bao gồm trong gói premium',
      addon_add: 'Thêm',
      addon_added: 'Đã thêm',
      addon_in_use: 'Đang dùng',
      addon_sold_out: 'Hết hàng',
      addon_view: 'Xem',
      total_saved: 'Tổng tiết kiệm',
      taxes_duties: 'Thuế và phí đã bao gồm, phí vận chuyển tính khi thanh toán.',
      trust_text: 'Thanh toán an toàn · Đổi trả trong 30 ngày · Giao hàng nhanh'
    }
  },

  'zh-CN': {
    rebuild_kit_picker: {
      banner_label: '立省30%',
      banner_title: '完成您的 Rebuild Kit',
      banner_sub: '将 OralBiome 与 FlowCore 颜色搭配，立享30%折扣。',
      combi_label: 'Rebuild Kit 套装 · 享30%折扣',
      modal_title: '选择您的 FlowCore 颜色',
      modal_sub: 'Rebuild Kit 套装在结账时自动节省30%。',
      cta: '加入套装',
      rrp: '建议零售价',
      bundle_price_suffix: '含 Rebuild Kit',
      empty: '尚未配置 FlowCore 颜色。请在 Theme Editor → CALQIX · Rebuild Kit Bundle 中设置集合。',
      footer: '结账时自动享受折扣。'
    },
    calqix_cart: {
      free_shipping_text_prefix: '再购 ',
      free_shipping_text_suffix: ' 即享免费配送！',
      free_shipping_success: '您已解锁免费配送！',
      urgency_text: '今日热销产品。赶快下单，以免错过。',
      addons_heading: '常备好物',
      addon_1_title: '旅行包',
      addon_1_text: '旅行中也能保护您的 FlowCore。',
      addon_2_title: '优先支持',
      addon_2_text: '购买后获得直接支持与指导。',
      addon_2_price: '高级套餐已包含',
      addon_add: '添加',
      addon_added: '已添加',
      addon_in_use: '使用中',
      addon_sold_out: '售罄',
      addon_view: '查看',
      total_saved: '总计节省',
      taxes_duties: '含税费，运费将在结账时计算。',
      trust_text: '安全结账 · 30天退货 · 快速配送'
    }
  },

  'zh-TW': {
    rebuild_kit_picker: {
      banner_label: '省30%',
      banner_title: '完成您的 Rebuild Kit',
      banner_sub: '將 OralBiome 與 FlowCore 顏色搭配，立享30%折扣。',
      combi_label: 'Rebuild Kit 組合 · 享30%折扣',
      modal_title: '選擇您的 FlowCore 顏色',
      modal_sub: 'Rebuild Kit 組合在結帳時自動節省30%。',
      cta: '加入套裝',
      rrp: '建議售價',
      bundle_price_suffix: '含 Rebuild Kit',
      empty: '尚未設定 FlowCore 顏色。請在 Theme Editor → CALQIX · Rebuild Kit Bundle 中設定系列。',
      footer: '結帳時自動享有折扣。'
    },
    calqix_cart: {
      free_shipping_text_prefix: '再買 ',
      free_shipping_text_suffix: ' 即享免費配送！',
      free_shipping_success: '您已解鎖免費配送！',
      urgency_text: '今日熱銷商品。趕快下訂，免得錯過。',
      addons_heading: '常備實用',
      addon_1_title: '旅行袋',
      addon_1_text: '旅行中也能保護您的 FlowCore。',
      addon_2_title: '優先客服',
      addon_2_text: '購買後獲得直接客服與指導。',
      addon_2_price: '高級方案已包含',
      addon_add: '新增',
      addon_added: '已新增',
      addon_in_use: '使用中',
      addon_sold_out: '售完',
      addon_view: '檢視',
      total_saved: '總計節省',
      taxes_duties: '含稅費，運費將於結帳時計算。',
      trust_text: '安全結帳 · 30天退換 · 快速配送'
    }
  }
};

/* ------------------------------------------------------------
 * Runner
 * ------------------------------------------------------------ */

function stripBom(str) {
  return str.charCodeAt(0) === 0xFEFF ? str.slice(1) : str;
}

function splitHeader(raw) {
  // Preserve a leading `/* ... */` comment block if the locale
  // file has Shopify's auto-generated header.
  const m = raw.match(/^\s*\/\*[\s\S]*?\*\/\s*\n/);
  if (!m) return { header: '', body: raw };
  return { header: m[0], body: raw.slice(m[0].length) };
}

function deepMerge(existing, incoming) {
  // Merge `incoming` keys into `existing` ONLY when the key is
  // missing. Never overwrite existing translations.
  const out = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (!(k in out)) out[k] = v;
  }
  return out;
}

function processLocale(locale, blocks) {
  const filePath = path.join(LOCALES_DIR, `${locale}.json`);
  if (!fs.existsSync(filePath)) {
    console.log(`[skip]   ${locale}  — file not found`);
    return { locale, status: 'missing-file' };
  }

  const rawOriginal = stripBom(fs.readFileSync(filePath, 'utf8'));
  const { header, body } = splitHeader(rawOriginal);

  let data;
  try {
    data = JSON.parse(body);
  } catch (err) {
    console.error(`[error]  ${locale}  — invalid JSON before edit: ${err.message}`);
    return { locale, status: 'parse-error' };
  }

  const changes = [];

  if (blocks.rebuild_kit_picker) {
    if (!data.cart) data.cart = {};
    if (!data.cart.rebuild_kit_picker) {
      data.cart.rebuild_kit_picker = blocks.rebuild_kit_picker;
      changes.push('rebuild_kit_picker:added');
    } else {
      const merged = deepMerge(data.cart.rebuild_kit_picker, blocks.rebuild_kit_picker);
      const added = Object.keys(blocks.rebuild_kit_picker).filter(
        (k) => !(k in data.cart.rebuild_kit_picker)
      );
      if (added.length) {
        data.cart.rebuild_kit_picker = merged;
        changes.push(`rebuild_kit_picker:filled(${added.join(',')})`);
      }
    }
  }

  if (blocks.calqix_cart) {
    if (!data.calqix_cart) {
      data.calqix_cart = blocks.calqix_cart;
      changes.push('calqix_cart:added');
    } else {
      const added = Object.keys(blocks.calqix_cart).filter(
        (k) => !(k in data.calqix_cart)
      );
      if (added.length) {
        data.calqix_cart = deepMerge(data.calqix_cart, blocks.calqix_cart);
        changes.push(`calqix_cart:filled(${added.join(',')})`);
      }
    }
  }

  if (!changes.length) {
    console.log(`[ok]     ${locale}  — already complete`);
    return { locale, status: 'already-complete' };
  }

  const serialised = JSON.stringify(data, null, 2);
  const out = header + serialised + '\n';

  // Round-trip validate before writing.
  try {
    JSON.parse(stripBom(header ? out.slice(header.length) : out));
  } catch (err) {
    console.error(`[error]  ${locale}  — serialisation produced invalid JSON: ${err.message}`);
    return { locale, status: 'serialise-error' };
  }

  fs.writeFileSync(filePath, out, 'utf8');
  console.log(`[write]  ${locale}  — ${changes.join(' · ')}`);
  return { locale, status: 'written', changes };
}

function main() {
  const results = [];
  for (const [locale, blocks] of Object.entries(T)) {
    results.push(processLocale(locale, blocks));
  }

  console.log('\n=== Summary ===');
  const byStatus = {};
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }
  for (const [k, v] of Object.entries(byStatus)) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }
}

main();
