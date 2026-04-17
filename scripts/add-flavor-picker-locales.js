/*
 * One-off locale utility: injects top-level `cart.flavor_picker.*` keys
 * into every customer-facing locale JSON under /locales.
 * Preserves the leading auto-generated comment block and 2-space indent.
 */
const fs = require("fs");
const path = require("path");

const LOCALES_DIR = path.resolve(__dirname, "..", "locales");

const TRANSLATIONS = {
  "en.default": {
    change: "Change flavor",
    choose: "Choose your flavors",
    choose_hint: "Pick a flavor for each jar. Defaults to the selected flavor.",
    jar: "Jar",
    update: "Update cart",
    hint: "Tap a jar to swap this line",
    added: "Flavors added",
  },
  nl: {
    change: "Smaak wijzigen",
    choose: "Kies je smaken",
    choose_hint: "Kies een smaak voor elke pot. Standaard de gekozen smaak.",
    jar: "Pot",
    update: "Winkelwagen bijwerken",
    hint: "Tik op een pot om deze regel te wisselen",
    added: "Smaken toegevoegd",
  },
  de: {
    change: "Geschmack ändern",
    choose: "Wählen Sie Ihre Geschmacksrichtungen",
    choose_hint: "Wählen Sie einen Geschmack pro Dose. Standard ist die gewählte Sorte.",
    jar: "Dose",
    update: "Warenkorb aktualisieren",
    hint: "Tippen Sie auf eine Dose, um diese Zeile zu ändern",
    added: "Geschmacksrichtungen hinzugefügt",
  },
  fr: {
    change: "Changer de saveur",
    choose: "Choisissez vos saveurs",
    choose_hint: "Choisissez une saveur par pot. Par défaut, la saveur sélectionnée.",
    jar: "Pot",
    update: "Mettre à jour le panier",
    hint: "Touchez un pot pour remplacer cette ligne",
    added: "Saveurs ajoutées",
  },
  ar: {
    change: "تغيير النكهة",
    choose: "اختر نكهاتك",
    choose_hint: "اختر نكهة لكل علبة. الافتراضي هو النكهة المحددة.",
    jar: "علبة",
    update: "تحديث السلة",
    hint: "اضغط على علبة لاستبدال هذا السطر",
    added: "تمت إضافة النكهات",
  },
  "bg-BG": {
    change: "Смяна на вкуса",
    choose: "Изберете вкусовете си",
    choose_hint: "Изберете вкус за всеки буркан. По подразбиране – избраният вкус.",
    jar: "Буркан",
    update: "Обнови количката",
    hint: "Докоснете буркан, за да замените този ред",
    added: "Вкусовете са добавени",
  },
  cs: {
    change: "Změnit příchuť",
    choose: "Vyberte si příchutě",
    choose_hint: "Vyberte příchuť pro každou dózu. Výchozí je zvolená příchuť.",
    jar: "Dóza",
    update: "Aktualizovat košík",
    hint: "Klepněte na dózu pro výměnu této položky",
    added: "Příchutě přidány",
  },
  da: {
    change: "Skift smag",
    choose: "Vælg dine smagsvarianter",
    choose_hint: "Vælg en smag til hver dåse. Standard er den valgte smag.",
    jar: "Dåse",
    update: "Opdater kurv",
    hint: "Tryk på en dåse for at udskifte denne linje",
    added: "Smagsvarianter tilføjet",
  },
  el: {
    change: "Αλλαγή γεύσης",
    choose: "Επιλέξτε τις γεύσεις σας",
    choose_hint: "Επιλέξτε μια γεύση για κάθε βαζάκι. Προεπιλογή: η επιλεγμένη γεύση.",
    jar: "Βαζάκι",
    update: "Ενημέρωση καλαθιού",
    hint: "Πατήστε σε ένα βαζάκι για να αλλάξετε αυτή τη γραμμή",
    added: "Οι γεύσεις προστέθηκαν",
  },
  es: {
    change: "Cambiar sabor",
    choose: "Elige tus sabores",
    choose_hint: "Elige un sabor para cada bote. Por defecto, el sabor seleccionado.",
    jar: "Bote",
    update: "Actualizar carrito",
    hint: "Toca un bote para cambiar esta línea",
    added: "Sabores añadidos",
  },
  fi: {
    change: "Vaihda makua",
    choose: "Valitse maut",
    choose_hint: "Valitse maku jokaiseen purkkiin. Oletuksena valittu maku.",
    jar: "Purkki",
    update: "Päivitä ostoskori",
    hint: "Napauta purkkia vaihtaaksesi tämän rivin",
    added: "Maut lisätty",
  },
  "hr-HR": {
    change: "Promijeni okus",
    choose: "Odaberite svoje okuse",
    choose_hint: "Odaberite okus za svaku staklenku. Zadano: odabrani okus.",
    jar: "Staklenka",
    update: "Ažuriraj košaricu",
    hint: "Dodirnite staklenku za zamjenu ove stavke",
    added: "Okusi dodani",
  },
  hu: {
    change: "Íz módosítása",
    choose: "Válassza ki az ízeket",
    choose_hint: "Válasszon ízt minden tégelyhez. Alapértelmezés: a kiválasztott íz.",
    jar: "Tégely",
    update: "Kosár frissítése",
    hint: "Érintsen meg egy tégelyt a csere érdekében",
    added: "Ízek hozzáadva",
  },
  id: {
    change: "Ubah rasa",
    choose: "Pilih rasa Anda",
    choose_hint: "Pilih rasa untuk setiap stoples. Default: rasa yang dipilih.",
    jar: "Stoples",
    update: "Perbarui keranjang",
    hint: "Ketuk stoples untuk mengganti baris ini",
    added: "Rasa ditambahkan",
  },
  it: {
    change: "Cambia gusto",
    choose: "Scegli i tuoi gusti",
    choose_hint: "Scegli un gusto per ogni barattolo. Predefinito: il gusto selezionato.",
    jar: "Barattolo",
    update: "Aggiorna carrello",
    hint: "Tocca un barattolo per sostituire questa riga",
    added: "Gusti aggiunti",
  },
  ja: {
    change: "フレーバーを変更",
    choose: "フレーバーを選択",
    choose_hint: "各ボトルのフレーバーを選択してください。初期値は選択中のフレーバーです。",
    jar: "ボトル",
    update: "カートを更新",
    hint: "ボトルをタップしてこの商品を交換",
    added: "フレーバーが追加されました",
  },
  ko: {
    change: "맛 변경",
    choose: "맛을 선택하세요",
    choose_hint: "각 병의 맛을 선택하세요. 기본값은 선택한 맛입니다.",
    jar: "병",
    update: "장바구니 업데이트",
    hint: "이 항목을 바꾸려면 병을 탭하세요",
    added: "맛이 추가되었습니다",
  },
  "lt-LT": {
    change: "Keisti skonį",
    choose: "Pasirinkite skonius",
    choose_hint: "Pasirinkite skonį kiekvienam indeliui. Numatytasis: pasirinktas skonis.",
    jar: "Indelis",
    update: "Atnaujinti krepšelį",
    hint: "Palieskite indelį, kad pakeistumėte šią eilutę",
    added: "Skoniai pridėti",
  },
  nb: {
    change: "Endre smak",
    choose: "Velg dine smaker",
    choose_hint: "Velg en smak for hver boks. Standard er den valgte smaken.",
    jar: "Boks",
    update: "Oppdater handlekurv",
    hint: "Trykk på en boks for å bytte denne linjen",
    added: "Smaker lagt til",
  },
  pl: {
    change: "Zmień smak",
    choose: "Wybierz smaki",
    choose_hint: "Wybierz smak dla każdego słoika. Domyślnie: wybrany smak.",
    jar: "Słoik",
    update: "Aktualizuj koszyk",
    hint: "Dotknij słoika, aby zamienić tę pozycję",
    added: "Smaki dodane",
  },
  "pt-BR": {
    change: "Alterar sabor",
    choose: "Escolha seus sabores",
    choose_hint: "Escolha um sabor para cada pote. Padrão: o sabor selecionado.",
    jar: "Pote",
    update: "Atualizar carrinho",
    hint: "Toque em um pote para trocar esta linha",
    added: "Sabores adicionados",
  },
  "pt-PT": {
    change: "Alterar sabor",
    choose: "Escolha os seus sabores",
    choose_hint: "Escolha um sabor para cada frasco. Predefinição: o sabor selecionado.",
    jar: "Frasco",
    update: "Atualizar carrinho",
    hint: "Toque num frasco para trocar esta linha",
    added: "Sabores adicionados",
  },
  "ro-RO": {
    change: "Schimbă aroma",
    choose: "Alege aromele",
    choose_hint: "Alege o aromă pentru fiecare borcan. Implicit: aroma selectată.",
    jar: "Borcan",
    update: "Actualizează coșul",
    hint: "Apasă pe un borcan pentru a înlocui acest rând",
    added: "Arome adăugate",
  },
  ru: {
    change: "Изменить вкус",
    choose: "Выберите вкусы",
    choose_hint: "Выберите вкус для каждой банки. По умолчанию выбранный вкус.",
    jar: "Банка",
    update: "Обновить корзину",
    hint: "Коснитесь банки, чтобы заменить эту позицию",
    added: "Вкусы добавлены",
  },
  "sk-SK": {
    change: "Zmeniť príchuť",
    choose: "Vyberte si príchute",
    choose_hint: "Vyberte príchuť pre každú dózu. Predvolené: zvolená príchuť.",
    jar: "Dóza",
    update: "Aktualizovať košík",
    hint: "Ťuknite na dózu pre výmenu tejto položky",
    added: "Príchute pridané",
  },
  "sl-SI": {
    change: "Spremeni okus",
    choose: "Izberite okuse",
    choose_hint: "Izberite okus za vsak kozarec. Privzeto: izbrani okus.",
    jar: "Kozarec",
    update: "Posodobi košarico",
    hint: "Tapnite kozarec za zamenjavo te vrstice",
    added: "Okusi dodani",
  },
  sv: {
    change: "Ändra smak",
    choose: "Välj dina smaker",
    choose_hint: "Välj en smak för varje burk. Standard är den valda smaken.",
    jar: "Burk",
    update: "Uppdatera varukorg",
    hint: "Tryck på en burk för att byta denna rad",
    added: "Smaker tillagda",
  },
  th: {
    change: "เปลี่ยนรสชาติ",
    choose: "เลือกรสชาติของคุณ",
    choose_hint: "เลือกรสชาติสำหรับแต่ละกระปุก ค่าเริ่มต้นคือรสชาติที่เลือก",
    jar: "กระปุก",
    update: "อัปเดตรถเข็น",
    hint: "แตะกระปุกเพื่อเปลี่ยนรายการนี้",
    added: "เพิ่มรสชาติแล้ว",
  },
  tr: {
    change: "Aromayı değiştir",
    choose: "Aromalarınızı seçin",
    choose_hint: "Her kavanoz için bir aroma seçin. Varsayılan: seçili aroma.",
    jar: "Kavanoz",
    update: "Sepeti güncelle",
    hint: "Bu satırı değiştirmek için bir kavanoza dokunun",
    added: "Aromalar eklendi",
  },
  vi: {
    change: "Thay đổi hương vị",
    choose: "Chọn hương vị",
    choose_hint: "Chọn hương vị cho mỗi hũ. Mặc định là hương vị đã chọn.",
    jar: "Hũ",
    update: "Cập nhật giỏ hàng",
    hint: "Chạm vào hũ để đổi dòng này",
    added: "Đã thêm hương vị",
  },
  "zh-CN": {
    change: "更换口味",
    choose: "选择您的口味",
    choose_hint: "为每个罐子选择一种口味。默认为所选口味。",
    jar: "罐",
    update: "更新购物车",
    hint: "点击罐子以替换此项",
    added: "已添加口味",
  },
  "zh-TW": {
    change: "更換口味",
    choose: "選擇您的口味",
    choose_hint: "為每個罐子選擇一種口味。預設為所選口味。",
    jar: "罐",
    update: "更新購物車",
    hint: "點擊罐子以替換此項",
    added: "已新增口味",
  },
};

const FILE_NAMES = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".schema.json"));

// Escape a string for embedding as a JSON string value (without the quotes).
function jsonEscape(s) {
  return JSON.stringify(s).slice(1, -1);
}

for (const fileName of FILE_NAMES) {
  const filePath = path.join(LOCALES_DIR, fileName);
  const key = fileName.replace(/\.json$/, "");
  const t = TRANSLATIONS[key];
  if (!t) {
    console.warn("SKIP (no translation map)", fileName);
    continue;
  }

  const raw = fs.readFileSync(filePath, "utf8");

  // Skip if top-level cart.flavor_picker already exists.
  // Top-level cart block is 2-space indented in all files.
  if (/^  "cart":\s*\{[\s\S]*?"flavor_picker"/m.test(raw)) {
    console.log("SKIP (already has flavor_picker)", fileName);
    continue;
  }

  // Detect EOL style (LF vs CRLF) so we preserve it.
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";

  // Build the block to insert.
  const block =
    `  "cart": {${eol}` +
    `    "flavor_picker": {${eol}` +
    `      "change": "${jsonEscape(t.change)}",${eol}` +
    `      "choose": "${jsonEscape(t.choose)}",${eol}` +
    `      "choose_hint": "${jsonEscape(t.choose_hint)}",${eol}` +
    `      "jar": "${jsonEscape(t.jar)}",${eol}` +
    `      "update": "${jsonEscape(t.update)}",${eol}` +
    `      "hint": "${jsonEscape(t.hint)}",${eol}` +
    `      "added": "${jsonEscape(t.added)}"${eol}` +
    `    }${eol}` +
    `  },${eol}`;

  // Insert after the very first top-level `{` that opens the root object.
  // Match: either end of comment block `*/\n{\n` or start of file `{\n`.
  const openRe = /(^|\*\/\s*)\{\r?\n/;
  const m = raw.match(openRe);
  if (!m) {
    console.error("FAIL no root brace", fileName);
    process.exit(1);
  }

  const insertAt = m.index + m[0].length;
  const out = raw.slice(0, insertAt) + block + raw.slice(insertAt);

  // Validate the result as JSON (strip the comment block first).
  const validateBody = out.replace(/^\/\*[\s\S]*?\*\/\s*/, "");
  try {
    JSON.parse(validateBody);
  } catch (e) {
    console.error("FAIL validate", fileName, e.message);
    process.exit(1);
  }

  fs.writeFileSync(filePath, out, "utf8");
  console.log("OK", fileName);
}
