import { LANGUAGE_PACK_COPY } from "./language-pack-copy.js";
export const TRANSLATION_COPY = {
  en: {
    labels: {
      packs: LANGUAGE_PACK_COPY["en"],
      paused: "Translation paused",
      retryContinue: "Retry and continue",
      scope: "Translation scope",
      scopes: { body: "Main content", all: "Entire page" },
      engine: "Translation engine",
      chooseEngine: "Choose a translation engine",
      engineUnavailable:
        "This browser does not support the selected engine. Choose another translation engine.",
      engines: {
        ai: "AI model",
        microsoft: "Microsoft online",
        browser: "Browser on-device",
      },
      microsoftNotice: "Text is sent to Microsoft. No API key is needed.",
      browserNotice:
        "Text stays on this device. A supported browser and language packs are required; the first translation may download them.",
    },
    errors: {
      translationFailed: "Translation failed. Please try again.",
      translationTimeout: "Translation timed out. Please try again.",
      translationPermission:
        "Open the extension popup and click Run action to allow access to Microsoft translation.",
      translationUnavailable:
        "This browser or page does not support on-device translation. Try a supported desktop browser on an HTTPS page.",
      translationLanguageUnavailable:
        "On-device translation does not support this language pair.",
      translationDownload:
        "Open Text translation on an HTTPS page, select the source language and click Translate to prepare local translation. Then try again.",
      translationDetection:
        "Could not detect the source language. Please select it.",
    },
  },
  "zh-CN": {
    labels: {
      packs: LANGUAGE_PACK_COPY["zh-CN"],
      paused: "翻译已暂停",
      retryContinue: "重试并继续",
      scope: "翻译范围",
      scopes: { body: "正文", all: "整页" },
      engine: "翻译引擎",
      chooseEngine: "请选择翻译引擎",
      engineUnavailable: "当前浏览器不支持已选引擎，请选择其他翻译引擎。",
      engines: {
        ai: "AI 模型",
        microsoft: "微软在线翻译",
        browser: "浏览器本地翻译",
      },
      microsoftNotice: "文字会发送到微软，无需 API Key。",
      browserNotice:
        "文字在本机处理，需要浏览器与语言包支持；首次翻译可能需要下载语言包。",
    },
    errors: {
      translationFailed: "翻译失败，请重试。",
      translationTimeout: "翻译超时，请重试。",
      translationPermission:
        "请打开插件弹窗，点击“开始处理”以授权访问微软翻译服务。",
      translationUnavailable:
        "当前浏览器或页面不支持本地翻译，请在支持的桌面浏览器中打开 HTTPS 网页。",
      translationLanguageUnavailable: "本地翻译暂不支持这组语言。",
      translationDownload:
        "请在 HTTPS 网页打开“文本翻译”，指定源语言并点击“翻译”以准备本地翻译，再重试。",
      translationDetection: "无法识别源语言，请手动选择。",
    },
  },
  "zh-TW": {
    labels: {
      packs: LANGUAGE_PACK_COPY["zh-TW"],
      paused: "翻譯已暫停",
      retryContinue: "重試並繼續",
      scope: "翻譯範圍",
      scopes: { body: "正文", all: "整頁" },
      engine: "翻譯引擎",
      chooseEngine: "請選擇翻譯引擎",
      engineUnavailable: "目前瀏覽器不支援已選引擎，請選擇其他翻譯引擎。",
      engines: {
        ai: "AI 模型",
        microsoft: "微軟線上翻譯",
        browser: "瀏覽器本機翻譯",
      },
      microsoftNotice: "文字會傳送到微軟，無需 API Key。",
      browserNotice:
        "文字在本機處理，需要瀏覽器與語言套件支援；首次翻譯可能需要下載語言套件。",
    },
    errors: {
      translationFailed: "翻譯失敗，請重試。",
      translationTimeout: "翻譯逾時，請重試。",
      translationPermission:
        "請開啟擴充功能彈窗，點選「執行處理」以授權存取微軟翻譯服務。",
      translationUnavailable:
        "目前瀏覽器或頁面不支援本機翻譯，請在支援的桌面瀏覽器中開啟 HTTPS 網頁。",
      translationLanguageUnavailable: "本機翻譯暫不支援這組語言。",
      translationDownload:
        "請在 HTTPS 網頁開啟「文字翻譯」，指定來源語言並點擊「翻譯」以準備本機翻譯，再重試。",
      translationDetection: "無法辨識來源語言，請手動選擇。",
    },
  },
  ja: {
    labels: {
      packs: LANGUAGE_PACK_COPY["ja"],
      paused: "翻訳を一時停止しました",
      retryContinue: "再試行して続ける",
      scope: "翻訳範囲",
      scopes: { body: "本文", all: "ページ全体" },
      engine: "翻訳エンジン",
      chooseEngine: "翻訳エンジンを選択",
      engineUnavailable:
        "このブラウザは選択中のエンジンに対応していません。別の翻訳エンジンを選択してください。",
      engines: {
        ai: "AI モデル",
        microsoft: "Microsoft オンライン翻訳",
        browser: "ブラウザー内翻訳",
      },
      microsoftNotice:
        "テキストは Microsoft に送信されます。API キーは不要です。",
      browserNotice:
        "テキストは端末内で処理されます。対応ブラウザーと言語パックが必要です。初回はダウンロードする場合があります。",
    },
    errors: {
      translationFailed: "翻訳に失敗しました。再試行してください。",
      translationTimeout: "翻訳がタイムアウトしました。再試行してください。",
      translationPermission:
        "拡張機能のポップアップを開き、「アクションを実行」をクリックして Microsoft 翻訳へのアクセスを許可してください。",
      translationUnavailable:
        "このブラウザーまたはページは端末内翻訳に対応していません。対応するデスクトップブラウザーで HTTPS ページを開いてください。",
      translationLanguageUnavailable:
        "この言語の組み合わせは端末内翻訳に対応していません。",
      translationDownload:
        "HTTPS ページでテキスト翻訳を開き、翻訳元の言語を指定して翻訳をクリックし、ローカル翻訳を準備してください。",
      translationDetection:
        "翻訳元の言語を検出できません。手動で選択してください。",
    },
  },
  ko: {
    labels: {
      packs: LANGUAGE_PACK_COPY["ko"],
      paused: "번역이 일시 중지됨",
      retryContinue: "다시 시도하고 계속",
      scope: "번역 범위",
      scopes: { body: "본문", all: "전체 페이지" },
      engine: "번역 엔진",
      chooseEngine: "번역 엔진 선택",
      engineUnavailable:
        "이 브라우저는 선택한 엔진을 지원하지 않습니다. 다른 번역 엔진을 선택하세요.",
      engines: {
        ai: "AI 모델",
        microsoft: "Microsoft 온라인 번역",
        browser: "브라우저 기기 내 번역",
      },
      microsoftNotice:
        "텍스트가 Microsoft로 전송됩니다. API 키는 필요하지 않습니다.",
      browserNotice:
        "텍스트는 기기에서 처리됩니다. 지원 브라우저와 언어 팩이 필요하며 처음에는 다운로드할 수 있습니다.",
    },
    errors: {
      translationFailed: "번역에 실패했습니다. 다시 시도하세요.",
      translationTimeout: "번역 시간이 초과되었습니다. 다시 시도하세요.",
      translationPermission:
        "확장 팝업을 열고 ‘작업 실행’을 클릭하여 Microsoft 번역 서비스 접근을 허용하세요.",
      translationUnavailable:
        "이 브라우저나 페이지는 기기 내 번역을 지원하지 않습니다. 지원되는 데스크톱 브라우저에서 HTTPS 페이지를 여세요.",
      translationLanguageUnavailable:
        "이 언어 쌍은 기기 내 번역에서 지원되지 않습니다.",
      translationDownload:
        "HTTPS 페이지에서 텍스트 번역을 열고 원본 언어를 지정한 뒤 번역을 눌러 로컬 번역을 준비하세요.",
      translationDetection: "원본 언어를 감지할 수 없습니다. 직접 선택하세요.",
    },
  },
  fr: {
    labels: {
      packs: LANGUAGE_PACK_COPY["fr"],
      paused: "Traduction en pause",
      retryContinue: "Réessayer et continuer",
      scope: "Portée de la traduction",
      scopes: { body: "Contenu principal", all: "Page entière" },
      engine: "Moteur de traduction",
      chooseEngine: "Choisir un moteur de traduction",
      engineUnavailable:
        "Ce navigateur ne prend pas en charge le moteur sélectionné. Choisissez un autre moteur de traduction.",
      engines: {
        ai: "Modèle IA",
        microsoft: "Microsoft en ligne",
        browser: "Traduction locale du navigateur",
      },
      microsoftNotice:
        "Le texte est envoyé à Microsoft. Aucune clé API nécessaire.",
      browserNotice:
        "Le texte reste sur cet appareil. Un navigateur compatible et des packs de langues sont nécessaires ; un téléchargement peut être requis au premier usage.",
    },
    errors: {
      translationFailed: "Échec de la traduction. Réessayez.",
      translationTimeout: "La traduction a expiré. Réessayez.",
      translationPermission:
        "Ouvrez la fenêtre de l’extension et cliquez sur « Exécuter l’action » pour autoriser l’accès à Microsoft Traduction.",
      translationUnavailable:
        "Ce navigateur ou cette page ne prend pas en charge la traduction locale. Utilisez un navigateur de bureau compatible sur une page HTTPS.",
      translationLanguageUnavailable:
        "Cette paire de langues n’est pas prise en charge en local.",
      translationDownload:
        "Sur une page HTTPS, ouvrez Traduction de texte, choisissez la langue source puis cliquez sur Traduire pour préparer la traduction locale.",
      translationDetection:
        "Impossible de détecter la langue source. Sélectionnez-la.",
    },
  },
  de: {
    labels: {
      packs: LANGUAGE_PACK_COPY["de"],
      paused: "Übersetzung pausiert",
      retryContinue: "Erneut versuchen und fortsetzen",
      scope: "Übersetzungsbereich",
      scopes: { body: "Hauptinhalt", all: "Gesamte Seite" },
      engine: "Übersetzungsdienst",
      chooseEngine: "Übersetzungsdienst auswählen",
      engineUnavailable:
        "Dieser Browser unterstützt den ausgewählten Dienst nicht. Wählen Sie einen anderen Übersetzungsdienst.",
      engines: {
        ai: "KI-Modell",
        microsoft: "Microsoft online",
        browser: "Lokale Browserübersetzung",
      },
      microsoftNotice:
        "Der Text wird an Microsoft gesendet. Kein API-Schlüssel erforderlich.",
      browserNotice:
        "Der Text bleibt auf diesem Gerät. Ein unterstützter Browser und Sprachpakete sind nötig; beim ersten Mal kann ein Download erforderlich sein.",
    },
    errors: {
      translationFailed: "Übersetzung fehlgeschlagen. Bitte erneut versuchen.",
      translationTimeout:
        "Zeitüberschreitung bei der Übersetzung. Bitte erneut versuchen.",
      translationPermission:
        "Öffnen Sie das Erweiterungs-Popup und klicken Sie auf „Aktion ausführen“, um den Zugriff auf Microsoft Translator zu erlauben.",
      translationUnavailable:
        "Dieser Browser oder diese Seite unterstützt keine lokale Übersetzung. Öffnen Sie eine HTTPS-Seite in einem unterstützten Desktopbrowser.",
      translationLanguageUnavailable:
        "Dieses Sprachpaar wird lokal nicht unterstützt.",
      translationDownload:
        "Öffnen Sie Textübersetzung auf einer HTTPS-Seite, wählen Sie die Ausgangssprache und klicken Sie auf Übersetzen, um die lokale Übersetzung vorzubereiten.",
      translationDetection:
        "Ausgangssprache nicht erkannt. Bitte manuell wählen.",
    },
  },
  es: {
    labels: {
      packs: LANGUAGE_PACK_COPY["es"],
      paused: "Traducción en pausa",
      retryContinue: "Reintentar y continuar",
      scope: "Alcance de la traducción",
      scopes: { body: "Contenido principal", all: "Página completa" },
      engine: "Motor de traducción",
      chooseEngine: "Elige un motor de traducción",
      engineUnavailable:
        "Este navegador no admite el motor seleccionado. Elige otro motor de traducción.",
      engines: {
        ai: "Modelo de IA",
        microsoft: "Microsoft en línea",
        browser: "Traducción local del navegador",
      },
      microsoftNotice:
        "El texto se envía a Microsoft. No se necesita clave API.",
      browserNotice:
        "El texto permanece en este dispositivo. Se requieren un navegador compatible y paquetes de idiomas; el primer uso puede descargarlos.",
    },
    errors: {
      translationFailed: "La traducción falló. Inténtalo de nuevo.",
      translationTimeout:
        "La traducción agotó el tiempo de espera. Inténtalo de nuevo.",
      translationPermission:
        "Abre la ventana de la extensión y pulsa «Ejecutar acción» para autorizar el acceso al servicio de traducción de Microsoft.",
      translationUnavailable:
        "Este navegador o página no admite traducción local. Usa un navegador de escritorio compatible en una página HTTPS.",
      translationLanguageUnavailable:
        "Este par de idiomas no admite traducción local.",
      translationDownload:
        "Abre Traducción de texto en una página HTTPS, selecciona el idioma de origen y pulsa Traducir para preparar la traducción local.",
      translationDetection:
        "No se pudo detectar el idioma de origen. Selecciónalo.",
    },
  },
  "pt-BR": {
    labels: {
      packs: LANGUAGE_PACK_COPY["pt-BR"],
      paused: "Tradução pausada",
      retryContinue: "Tentar novamente e continuar",
      scope: "Escopo da tradução",
      scopes: { body: "Conteúdo principal", all: "Página inteira" },
      engine: "Mecanismo de tradução",
      chooseEngine: "Escolha um mecanismo de tradução",
      engineUnavailable:
        "Este navegador não oferece suporte ao mecanismo selecionado. Escolha outro mecanismo de tradução.",
      engines: {
        ai: "Modelo de IA",
        microsoft: "Microsoft online",
        browser: "Tradução local do navegador",
      },
      microsoftNotice:
        "O texto é enviado à Microsoft. Não é necessária uma chave de API.",
      browserNotice:
        "O texto fica neste dispositivo. É preciso um navegador compatível e pacotes de idiomas; o primeiro uso pode baixá-los.",
    },
    errors: {
      translationFailed: "Falha na tradução. Tente novamente.",
      translationTimeout: "A tradução excedeu o tempo limite. Tente novamente.",
      translationPermission:
        "Abra o popup da extensão e clique em “Executar ação” para autorizar o acesso ao serviço de tradução da Microsoft.",
      translationUnavailable:
        "Este navegador ou página não suporta tradução local. Use um navegador de desktop compatível em uma página HTTPS.",
      translationLanguageUnavailable:
        "Este par de idiomas não é suportado localmente.",
      translationDownload:
        "Abra Tradução de texto em uma página HTTPS, selecione o idioma de origem e clique em Traduzir para preparar a tradução local.",
      translationDetection:
        "Não foi possível detectar o idioma de origem. Selecione-o.",
    },
  },
  ru: {
    labels: {
      packs: LANGUAGE_PACK_COPY["ru"],
      paused: "Перевод приостановлен",
      retryContinue: "Повторить и продолжить",
      scope: "Область перевода",
      scopes: { body: "Основной текст", all: "Вся страница" },
      engine: "Движок перевода",
      chooseEngine: "Выберите движок перевода",
      engineUnavailable:
        "Этот браузер не поддерживает выбранный движок. Выберите другой движок перевода.",
      engines: {
        ai: "Модель ИИ",
        microsoft: "Microsoft онлайн",
        browser: "Локальный перевод браузера",
      },
      microsoftNotice: "Текст отправляется в Microsoft. Ключ API не требуется.",
      browserNotice:
        "Текст остаётся на устройстве. Нужны совместимый браузер и языковые пакеты; при первом использовании возможна их загрузка.",
    },
    errors: {
      translationFailed: "Не удалось перевести. Попробуйте снова.",
      translationTimeout: "Время перевода истекло. Попробуйте снова.",
      translationPermission:
        "Откройте всплывающее окно расширения и нажмите «Выполнить действие», чтобы разрешить доступ к переводу Microsoft.",
      translationUnavailable:
        "Браузер или страница не поддерживает локальный перевод. Откройте HTTPS-страницу в совместимом настольном браузере.",
      translationLanguageUnavailable:
        "Локальный перевод не поддерживает эту языковую пару.",
      translationDownload:
        "Откройте перевод текста на HTTPS-странице, выберите исходный язык и нажмите «Перевести», чтобы подготовить локальный перевод.",
      translationDetection:
        "Не удалось определить исходный язык. Выберите его вручную.",
    },
  },
  id: {
    labels: {
      packs: LANGUAGE_PACK_COPY["id"],
      paused: "Terjemahan dijeda",
      retryContinue: "Coba lagi dan lanjutkan",
      scope: "Cakupan terjemahan",
      scopes: { body: "Konten utama", all: "Seluruh halaman" },
      engine: "Mesin terjemahan",
      chooseEngine: "Pilih mesin terjemahan",
      engineUnavailable:
        "Browser ini tidak mendukung mesin yang dipilih. Pilih mesin terjemahan lain.",
      engines: {
        ai: "Model AI",
        microsoft: "Microsoft online",
        browser: "Terjemahan lokal browser",
      },
      microsoftNotice: "Teks dikirim ke Microsoft. Tidak memerlukan kunci API.",
      browserNotice:
        "Teks tetap di perangkat ini. Memerlukan browser dan paket bahasa yang didukung; penggunaan pertama mungkin mengunduhnya.",
    },
    errors: {
      translationFailed: "Terjemahan gagal. Coba lagi.",
      translationTimeout: "Waktu terjemahan habis. Coba lagi.",
      translationPermission:
        "Buka popup ekstensi dan klik “Jalankan tindakan” untuk mengizinkan akses ke layanan terjemahan Microsoft.",
      translationUnavailable:
        "Browser atau halaman ini tidak mendukung terjemahan lokal. Gunakan browser desktop yang didukung pada halaman HTTPS.",
      translationLanguageUnavailable:
        "Pasangan bahasa ini tidak didukung secara lokal.",
      translationDownload:
        "Buka Terjemahan teks pada halaman HTTPS, pilih bahasa sumber lalu klik Terjemahkan untuk menyiapkan terjemahan lokal.",
      translationDetection:
        "Bahasa sumber tidak terdeteksi. Pilih secara manual.",
    },
  },
  it: {
    labels: {
      packs: LANGUAGE_PACK_COPY["it"],
      paused: "Traduzione in pausa",
      retryContinue: "Riprova e continua",
      scope: "Ambito della traduzione",
      scopes: { body: "Contenuto principale", all: "Pagina intera" },
      engine: "Motore di traduzione",
      chooseEngine: "Scegli un motore di traduzione",
      engineUnavailable:
        "Questo browser non supporta il motore selezionato. Scegli un altro motore di traduzione.",
      engines: {
        ai: "Modello IA",
        microsoft: "Microsoft online",
        browser: "Traduzione locale del browser",
      },
      microsoftNotice:
        "Il testo viene inviato a Microsoft. Non serve una chiave API.",
      browserNotice:
        "Il testo rimane sul dispositivo. Servono un browser compatibile e pacchetti linguistici; al primo utilizzo potrebbe essere necessario scaricarli.",
    },
    errors: {
      translationFailed: "Traduzione non riuscita. Riprova.",
      translationTimeout: "Tempo scaduto per la traduzione. Riprova.",
      translationPermission:
        "Apri il popup dell’estensione e fai clic su «Esegui azione» per autorizzare l’accesso al servizio di traduzione Microsoft.",
      translationUnavailable:
        "Questo browser o pagina non supporta la traduzione locale. Usa un browser desktop compatibile su una pagina HTTPS.",
      translationLanguageUnavailable:
        "Questa coppia di lingue non è supportata localmente.",
      translationDownload:
        "Apri Traduzione del testo su una pagina HTTPS, scegli la lingua di origine e premi Traduci per preparare la traduzione locale.",
      translationDetection:
        "Impossibile rilevare la lingua di origine. Selezionala.",
    },
  },
  tr: {
    labels: {
      packs: LANGUAGE_PACK_COPY["tr"],
      paused: "Çeviri duraklatıldı",
      retryContinue: "Yeniden dene ve devam et",
      scope: "Çeviri kapsamı",
      scopes: { body: "Ana içerik", all: "Tüm sayfa" },
      engine: "Çeviri motoru",
      chooseEngine: "Bir çeviri motoru seçin",
      engineUnavailable:
        "Bu tarayıcı seçili motoru desteklemiyor. Başka bir çeviri motoru seçin.",
      engines: {
        ai: "Yapay zekâ modeli",
        microsoft: "Microsoft çevrimiçi",
        browser: "Tarayıcıda yerel çeviri",
      },
      microsoftNotice: "Metin Microsoft’a gönderilir. API anahtarı gerekmez.",
      browserNotice:
        "Metin bu cihazda kalır. Desteklenen bir tarayıcı ve dil paketleri gerekir; ilk kullanımda indirilebilir.",
    },
    errors: {
      translationFailed: "Çeviri başarısız. Tekrar deneyin.",
      translationTimeout: "Çeviri zaman aşımına uğradı. Tekrar deneyin.",
      translationPermission:
        "Microsoft çeviri hizmetine erişim izni vermek için eklenti açılır penceresini açıp “İşlemi çalıştır”a tıklayın.",
      translationUnavailable:
        "Bu tarayıcı veya sayfa yerel çeviriyi desteklemiyor. Desteklenen bir masaüstü tarayıcıda HTTPS sayfası açın.",
      translationLanguageUnavailable:
        "Bu dil çifti yerel çeviride desteklenmiyor.",
      translationDownload:
        "HTTPS sayfasında Metin çevirisi açın, kaynak dili seçin ve yerel çeviriyi hazırlamak için Çevir’e tıklayın.",
      translationDetection: "Kaynak dil algılanamadı. Lütfen seçin.",
    },
  },
  th: {
    labels: {
      packs: LANGUAGE_PACK_COPY["th"],
      paused: "หยุดการแปลชั่วคราว",
      retryContinue: "ลองอีกครั้งและแปลต่อ",
      scope: "ขอบเขตการแปล",
      scopes: { body: "เนื้อหาหลัก", all: "ทั้งหน้า" },
      engine: "เครื่องมือแปล",
      chooseEngine: "เลือกเครื่องมือแปล",
      engineUnavailable:
        "เบราว์เซอร์นี้ไม่รองรับเครื่องมือที่เลือก โปรดเลือกเครื่องมือแปลอื่น",
      engines: {
        ai: "โมเดล AI",
        microsoft: "Microsoft ออนไลน์",
        browser: "แปลในอุปกรณ์ผ่านเบราว์เซอร์",
      },
      microsoftNotice: "ข้อความจะส่งไปยัง Microsoft ไม่ต้องใช้คีย์ API",
      browserNotice:
        "ข้อความอยู่บนอุปกรณ์นี้ ต้องใช้เบราว์เซอร์และชุดภาษาที่รองรับ การใช้ครั้งแรกอาจต้องดาวน์โหลด",
    },
    errors: {
      translationFailed: "แปลไม่สำเร็จ โปรดลองอีกครั้ง",
      translationTimeout: "การแปลหมดเวลา โปรดลองอีกครั้ง",
      translationPermission:
        "เปิดป๊อปอัปส่วนขยายแล้วคลิก “เรียกใช้คำสั่ง” เพื่ออนุญาตให้เข้าถึงบริการแปลของ Microsoft",
      translationUnavailable:
        "เบราว์เซอร์หรือหน้านี้ไม่รองรับการแปลในอุปกรณ์ โปรดเปิดหน้า HTTPS ในเบราว์เซอร์เดสก์ท็อปที่รองรับ",
      translationLanguageUnavailable:
        "ไม่รองรับคู่ภาษานี้สำหรับการแปลในอุปกรณ์",
      translationDownload:
        "เปิดการแปลข้อความบนหน้า HTTPS เลือกภาษาต้นฉบับแล้วคลิกแปลเพื่อเตรียมการแปลในเครื่อง",
      translationDetection: "ตรวจไม่พบภาษาต้นฉบับ โปรดเลือกเอง",
    },
  },
  vi: {
    labels: {
      packs: LANGUAGE_PACK_COPY["vi"],
      paused: "Đã tạm dừng dịch",
      retryContinue: "Thử lại và tiếp tục",
      scope: "Phạm vi dịch",
      scopes: { body: "Nội dung chính", all: "Toàn bộ trang" },
      engine: "Công cụ dịch",
      chooseEngine: "Chọn công cụ dịch",
      engineUnavailable:
        "Trình duyệt này không hỗ trợ công cụ đã chọn. Hãy chọn công cụ dịch khác.",
      engines: {
        ai: "Mô hình AI",
        microsoft: "Microsoft trực tuyến",
        browser: "Dịch cục bộ trong trình duyệt",
      },
      microsoftNotice: "Văn bản được gửi đến Microsoft. Không cần khóa API.",
      browserNotice:
        "Văn bản ở trên thiết bị này. Cần trình duyệt và gói ngôn ngữ được hỗ trợ; lần đầu có thể cần tải xuống.",
    },
    errors: {
      translationFailed: "Dịch thất bại. Vui lòng thử lại.",
      translationTimeout: "Dịch hết thời gian chờ. Vui lòng thử lại.",
      translationPermission:
        "Mở cửa sổ tiện ích và nhấn “Chạy thao tác” để cho phép truy cập dịch vụ dịch của Microsoft.",
      translationUnavailable:
        "Trình duyệt hoặc trang này không hỗ trợ dịch cục bộ. Hãy mở trang HTTPS trong trình duyệt máy tính được hỗ trợ.",
      translationLanguageUnavailable:
        "Dịch cục bộ không hỗ trợ cặp ngôn ngữ này.",
      translationDownload:
        "Mở Dịch văn bản trên trang HTTPS, chọn ngôn ngữ nguồn rồi nhấn Dịch để chuẩn bị bản dịch cục bộ.",
      translationDetection:
        "Không thể nhận diện ngôn ngữ nguồn. Vui lòng chọn thủ công.",
    },
  },
};
