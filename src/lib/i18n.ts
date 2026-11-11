export const LANGS = ["ru", "en", "kk"] as const;
export type Lang = (typeof LANGS)[number];

export function normalizeLang(value: unknown): Lang | undefined {
  return value === "en" || value === "kk" ? value : undefined;
}

export function langOf(value: unknown): Lang {
  return normalizeLang(value) ?? "ru";
}

export function langFromSearch(search: string): Lang {
  return explicitLangFromSearch(search) ?? "ru";
}

export function explicitLangFromSearch(search: string): Lang | undefined {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return normalizeLang(new URLSearchParams(query).get("lang"));
}

const UI = {
  menuProfile: { ru: "Мой профиль", en: "My profile", kk: "Менің профилім" },
  soundOn: { ru: "Звук включён", en: "Sound on", kk: "Дыбыс қосулы" },
  soundOff: { ru: "Звук выключен", en: "Sound off", kk: "Дыбыс өшірулі" },
  about: { ru: "О проекте", en: "About", kk: "Жоба туралы" },
  signOut: { ru: "Выйти", en: "Sign out", kk: "Шығу" },
  closeMenu: { ru: "Закрыть меню", en: "Close menu", kk: "Мәзірді жабу" },
  language: { ru: "Язык", en: "Language", kk: "Тіл" },
  member: { ru: "Участник", en: "Member", kk: "Қатысушы" },
  newChat: { ru: "Новый чат", en: "New chat", kk: "Жаңа чат" },
  newDialog: { ru: "Новый диалог", en: "New chat", kk: "Жаңа диалог" },
  searchHistory: { ru: "Поиск по истории", en: "Search history", kk: "Тарихтан іздеу" },
  nothingFound: { ru: "Ничего не нашлось", en: "Nothing found", kk: "Ештеңе табылмады" },
  noChats: { ru: "Диалогов пока нет", en: "No chats yet", kk: "Диалог әлі жоқ" },
  closeList: { ru: "Закрыть список", en: "Close list", kk: "Тізімді жабу" },
  hideHistory: { ru: "Скрыть историю", en: "Hide history", kk: "Тарихты жасыру" },
  showHistory: { ru: "Показать историю", en: "Show history", kk: "Тарихты көрсету" },
  shareDialog: { ru: "Поделиться диалогом", en: "Share chat", kk: "Диалогпен бөлісу" },
  circle: { ru: "Круг", en: "Circle", kk: "Шеңбер" },
  unreadUpdate: { ru: "Есть непрочитанное обновление", en: "There is an unread update", kk: "Оқылмаған жаңарту бар" },
  chatClosed: { ru: "Чат закрыт", en: "Chat is closed", kk: "Чат жабық" },
  describeImage: { ru: "Опишите картинку", en: "Describe the picture", kk: "Суретті сипаттаңыз" },
  askWeb: { ru: "Спросите — ИИ посмотрит в сети", en: "Ask — the AI will look on the open web", kk: "Сұраңыз — ЖИ ашық желіге қарайды" },
  writeMessage: { ru: "Напишите сообщение", en: "Write a message", kk: "Хабарлама жазыңыз" },
  howHelp: { ru: "Чем помочь?", en: "What can I help with?", kk: "Не көмектесейін?" },
  emptyPersonal: {
    ru: "Вопросы под ваши интересы. Напишите внизу или выберите карточку. Сменить темы можно в настройках.",
    en: "Questions follow your interests. Write below or pick a card. Topics can be changed in settings.",
    kk: "Сұрақтар қызығушылығыңызға сай. Төменге жазыңыз немесе карточканы таңдаңыз. Тақырыпты баптауда ауыстыруға болады.",
  },
  emptyPlain: {
    ru: "Напишите внизу. Можно включить «Сеть», чтобы ИИ посмотрел открытые источники, или «Картинка», чтобы нарисовать ответ.",
    en: "Write below. Turn on Web so the AI checks open sources, or Image to draw an answer.",
    kk: "Төменге жазыңыз. «Желі» ашық дереккөзді қарайды, «Сурет» жауапты салады.",
  },
  gathering: { ru: "Собираю вопросы…", en: "Gathering questions…", kk: "Сұрақтар жиналуда…" },
  toChat: { ru: "К чату", en: "To chat", kk: "Чатқа" },
  messages: { ru: "Сообщения", en: "Messages", kk: "Хабарламалар" },
  feed: { ru: "Лента", en: "Feed", kk: "Таспа" },
  play: { ru: "Развлечения", en: "Play", kk: "Ойын-сауық" },
  services: { ru: "Сервисы", en: "Services", kk: "Қызметтер" },
  disk: { ru: "Диск", en: "Disk", kk: "Диск" },
  bank: { ru: "Банк", en: "Bank", kk: "Банк" },
  shop: { ru: "Магазин", en: "Shop", kk: "Дүкен" },
  admin: { ru: "Админ", en: "Admin", kk: "Әкімші" },
  closedAccess: { ru: "Доступ закрыт", en: "Access closed", kk: "Қолжетім жабық" },
  subAdmin: { ru: "Модели, лимиты и участники", en: "Models, limits and members", kk: "Модельдер, лимит және қатысушылар" },
  subFeed: { ru: "Записи и ответы", en: "Posts and replies", kk: "Жазбалар мен жауаптар" },
  subPlay: { ru: "Читальня, смотрельня и игры", en: "Books, video and games", kk: "Кітап, бейне және ойын" },
  subServices: { ru: "Погода, новости, курсы и VPN", en: "Weather, news, rates and VPN", kk: "Ауа райы, жаңалық, бағам және VPN" },
  subDisk: { ru: "Картинки и голосовые", en: "Pictures and voice", kk: "Сурет пен дауыс" },
  subBank: { ru: "Вубли и переводы", en: "Vubles and transfers", kk: "Вубль және аударым" },
  subShop: { ru: "Подписка, место и персонажи", en: "Plan, space and characters", kk: "Жазылым, орын және кейіпкер" },
  subChat: { ru: "Друзья, диалоги и файлы", en: "Friends, chats and files", kk: "Достар, диалог және файл" },
  banned: {
    ru: "Аккаунт заблокирован. Сообщения, лента и встроенный чат для этого входа закрыты.",
    en: "This account is blocked. Messages, the feed and the built-in chat are closed for this sign-in.",
    kk: "Аккаунт бұғатталған. Хабарлама, таспа және ішкі чат осы кіру үшін жабық.",
  },
  pageLink: { ru: "Ссылка на эту страницу", en: "Link to this page", kk: "Осы беттің сілтемесі" },
  share: { ru: "Поделиться", en: "Share", kk: "Бөлісу" },
  copy: { ru: "Скопировать", en: "Copy", kk: "Көшіру" },
  copied: { ru: "Ссылка скопирована", en: "Link copied", kk: "Сілтеме көшірілді" },
  signInOpen: { ru: "Войти и открыть", en: "Sign in and open", kk: "Кіріп ашу" },
  otherSections: { ru: "Другие разделы", en: "Other sections", kk: "Басқа бөлімдер" },
  needAccount: { ru: "Нужен аккаунт", en: "Account required", kk: "Аккаунт керек" },
  signUp: { ru: "Регистрация", en: "Create account", kk: "Тіркелу" },
  signIn: { ru: "Вход", en: "Sign in", kk: "Кіру" },
  lockedLead: {
    ru: "Без регистрации можно задать только три вопроса, включая картинки. Создайте аккаунт или войдите — история диалогов сохранится за вами.",
    en: "Without an account you can ask only three questions, pictures included. Create an account or sign in and the chats stay with you.",
    kk: "Тіркелмей үш сұрақ қоюға болады, суретпен қоса. Аккаунт ашыңыз немесе кіріңіз — диалог тарихы сізде қалады.",
  },
  authLead: {
    ru: "Логин — это почта. Пароль и имя остаются в аккаунте и не пропадают после перезапуска.",
    en: "The login is your email. The password and name stay in the account after a reload.",
    kk: "Логин — пошта. Құпия сөз бен есім аккаунтта қалады, бет жаңарса да жоғалмайды.",
  },
  nameInCircle: { ru: "Имя в круге", en: "Name in the circle", kk: "Шеңбердегі есім" },
  login: { ru: "Логин", en: "Email", kk: "Логин" },
  password: { ru: "Пароль", en: "Password", kk: "Құпия сөз" },
  wait: { ru: "Секунду…", en: "One moment…", kk: "Сәт…" },
  createAccount: { ru: "Создать аккаунт", en: "Create account", kk: "Аккаунт ашу" },
  enter: { ru: "Войти", en: "Sign in", kk: "Кіру" },
  haveAccount: { ru: "Уже есть аккаунт — войти", en: "Already have an account — sign in", kk: "Аккаунт бар — кіру" },
  noAccount: { ru: "Нет аккаунта — регистрация", en: "No account — create one", kk: "Аккаунт жоқ — тіркелу" },
  forgot: { ru: "Забыли пароль?", en: "Forgot the password?", kk: "Құпия сөзді ұмыттыңыз ба?" },
  sendCode: { ru: "Отправить код", en: "Send the code", kk: "Код жіберу" },
  codeFromMail: { ru: "Код из письма", en: "Code from the email", kk: "Хаттағы код" },
  newPassword: { ru: "Новый пароль", en: "New password", kk: "Жаңа құпия сөз" },
  savePassword: { ru: "Сохранить пароль", en: "Save password", kk: "Құпия сөзді сақтау" },
  resendCode: { ru: "Выслать код ещё раз", en: "Send the code again", kk: "Кодты қайта жіберу" },
  backToSignIn: { ru: "Вернуться ко входу", en: "Back to sign in", kk: "Кіруге оралу" },
  resetAsk: {
    ru: "Напишите почту, с которой входили. Если она есть в аккаунте, пришлём код.",
    en: "Enter the email you used. If it belongs to an account, we will send a code.",
    kk: "Кірген поштаны жазыңыз. Аккаунтта болса, код жібереміз.",
  },
  addresses: { ru: "Адреса круга", en: "Circle addresses", kk: "Шеңбер мекенжайлары" },
  addressLead: {
    ru: "У каждого раздела свой адрес. Ссылку можно отправить, и откроется именно этот раздел.",
    en: "Each section has its own address. Send the link and that section opens.",
    kk: "Әр бөлімнің өз мекенжайы бар. Сілтемені жіберсеңіз, сол бөлім ашылады.",
  },
  install: { ru: "На экран", en: "On the home screen", kk: "Экранға" },
  installed: {
    ru: "Приложение уже открыто с домашнего экрана: без полоски браузера, со своими ярлыками разделов.",
    en: "The app is already open from the home screen: no browser bar, with its own section shortcuts.",
    kk: "Қолданба үй экранынан ашық: браузер жолағынсыз, бөлім жарлықтарымен.",
  },
  installLead: {
    ru: "vvvion.space ставится на телефон и на компьютер отдельным окном: свой значок и ярлыки разделов — сообщения, лента, развлечения, сервисы, диск, банк.",
    en: "vvvion.space installs on a phone or a computer as its own window: an icon and shortcuts for messages, feed, play, services, disk and bank.",
    kk: "vvvion.space телефон мен компьютерге бөлек терезе болып орнатылады: өз белгішесі және хабарлама, таспа, ойын-сауық, қызмет, диск, банк жарлықтары.",
  },
  installOffline: {
    ru: "Если сети нет, открывается короткая заглушка. Уже загруженные страницы можно не закрывать — они дождутся связи.",
    en: "Without a network a short placeholder opens. Pages already loaded can stay open until the connection returns.",
    kk: "Желі жоқ болса, қысқа бет ашылады. Жүктелген бетті жаппай-ақ қоюға болады — байланысты күтеді.",
  },
  installButton: { ru: "Поставить на экран", en: "Add to the home screen", kk: "Экранға қою" },
  installIos: {
    ru: "На iPhone: «Поделиться» в Safari, затем «На экран Домой».",
    en: "On iPhone: Share in Safari, then Add to Home Screen.",
    kk: "iPhone: Safari ішінде «Бөлісу», содан кейін «Үй экранына».",
  },
  installLook: { ru: "Как это выглядит", en: "How it looks", kk: "Қалай көрінеді" },
  installBrowser: {
    ru: "В меню браузера есть пункт «Установить приложение» или «Добавить на главный экран».",
    en: "The browser menu has Install app or Add to Home Screen.",
    kk: "Браузер мәзірінде «Қолданбаны орнату» немесе «Үй экранына қосу» бар.",
  },
  updatesTitle: { ru: "Что менялось", en: "What changed", kk: "Не өзгерді" },
  updatesLead: {
    ru: "Сейчас версия {version}. Ниже — журнал выпусков.",
    en: "Current version is {version}. The release log is below.",
    kk: "Қазіргі нұсқа {version}. Төменде шығарылым журналы.",
  },
  updatesNote: {
    ru: "Записи журнала ведутся на русском: так формулировки выпуска не расходятся.",
    en: "The log itself stays in Russian, so a release is not retold two ways.",
    kk: "Журнал орыс тілінде: шығарылым мәтіні екі түрлі айтылмасын.",
  },
  kindAdded: { ru: "Было добавлено", en: "Added", kk: "Қосылды" },
  kindFixed: { ru: "Было исправлено", en: "Fixed", kk: "Түзетілді" },
  kindFresh: { ru: "Новые", en: "New", kk: "Жаңа" },
  kindBetter: { ru: "Улучшили", en: "Improved", kk: "Жақсарды" },
  kindTuned: { ru: "Поправили", en: "Adjusted", kk: "Реттелді" },
  kindOpened: { ru: "Открыли", en: "Opened", kk: "Ашылды" },
  faq: { ru: "Вопросы", en: "Questions", kk: "Сұрақтар" },
  lightTheme: { ru: "Светлая тема", en: "Light theme", kk: "Жарық тақырып" },
  darkTheme: { ru: "Тёмная тема", en: "Dark theme", kk: "Қараңғы тақырып" },
  settings: { ru: "Настройки", en: "Settings", kk: "Баптау" },
  chat: { ru: "Чат", en: "Chat", kk: "Чат" },
  close: { ru: "Закрыть", en: "Close", kk: "Жабу" },
  closeCircle: { ru: "Закрыть круг", en: "Close the circle", kk: "Шеңберді жабу" },
  shareTitle: { ru: "Ссылка на диалог", en: "Link to the chat", kk: "Диалог сілтемесі" },
  shareNote: {
    ru: "Это копия переписки. Открыть её может только тот, у кого есть ссылка.",
    en: "This is a copy of the conversation. Only someone with the link can open it.",
    kk: "Бұл хаттың көшірмесі. Оны тек сілтемесі бар адам ашады.",
  },
  copyFailed: { ru: "Не удалось скопировать — выделите адрес", en: "Could not copy — select the address", kk: "Көшіру болмады — мекенжайды бөлектеңіз" },
  copyVerb: { ru: "Копировать", en: "Copy", kk: "Көшіру" },
  linkLabel: { ru: "Ссылка", en: "Link", kk: "Сілтеме" },
  today: { ru: "Сегодня", en: "Today", kk: "Бүгін" },
  yesterday: { ru: "Вчера", en: "Yesterday", kk: "Кеше" },
  thisWeek: { ru: "На этой неделе", en: "This week", kk: "Осы аптада" },
  exported: { ru: "Диалог экспортирован", en: "Chat exported", kk: "Диалог экспортталды" },
  you: { ru: "Вы", en: "You", kk: "Сіз" },
  unreadMark: { ru: "Непрочитано", en: "Unread", kk: "Оқылмаған" },
  rename: { ru: "Переименовать", en: "Rename", kk: "Атауын өзгерту" },
  downloadMd: { ru: "Скачать Markdown", en: "Download Markdown", kk: "Markdown жүктеу" },
  downloadJson: { ru: "Скачать JSON", en: "Download JSON", kk: "JSON жүктеу" },
  delete: { ru: "Удалить", en: "Delete", kk: "Жою" },
  deleteChat: { ru: "Удалить диалог?", en: "Delete this chat?", kk: "Диалогты жою керек пе?" },
  deleteChatBody: {
    ru: "«{title}» исчезнет из этого браузера. Восстановить его нельзя.",
    en: "“{title}” will leave this browser. It cannot be restored.",
    kk: "«{title}» осы браузерден кетеді. Қайтарылмайды.",
  },
  deleteAll: { ru: "Удалить все", en: "Delete all", kk: "Барлығын жою" },
  deleteAllChats: { ru: "Удалить все диалоги?", en: "Delete every chat?", kk: "Барлық диалогты жою керек пе?" },
  deleteAllBody: {
    ru: "Все диалоги исчезнут из этого браузера. Если вы вошли, они исчезнут и из аккаунта. Восстановить их нельзя.",
    en: "Every chat will leave this browser. If you are signed in, they leave the account too. They cannot be restored.",
    kk: "Барлық диалог осы браузерден кетеді. Кірген болсаңыз, аккаунттан да кетеді. Қайтарылмайды.",
  },
  cancel: { ru: "Отмена", en: "Cancel", kk: "Болдырмау" },
  filesHint: { ru: "Файлы. Несколько сразу, каждый до 200 МБ", en: "Files. Several at once, each up to 200 MB", kk: "Файл. Бірден бірнешеу, әрқайсысы 200 МБ-қа дейін" },
  voiceHint: { ru: "Голос. Текст появляется в поле, пока вы говорите", en: "Voice. Words appear in the field as you speak", kk: "Дауыс. Сөздер сөйлегенде өріске жазылады" },
  imageHint: { ru: "Картинка. Ответ будет изображением", en: "Image. The answer will be a picture", kk: "Сурет. Жауап сурет болады" },
  webHint: { ru: "Сеть. Ответ со ссылками из поиска", en: "Web. The answer comes with links from search", kk: "Желі. Жауап іздеу сілтемелерімен келеді" },
  image: { ru: "Картинка", en: "Image", kk: "Сурет" },
  web: { ru: "Сеть", en: "Web", kk: "Желі" },
  webSearch: { ru: "Поиск в сети", en: "Search the web", kk: "Желіде іздеу" },
  attach: { ru: "Приложить файлы", en: "Attach files", kk: "Файл тіркеу" },
  tooManyFiles: { ru: "Не больше 8 файлов", en: "No more than 8 files", kk: "8 файлдан артық емес" },
  fileTooBig: { ru: "Файл больше 200 МБ", en: "The file is over 200 MB", kk: "Файл 200 МБ-тан үлкен" },
  fileRejected: { ru: "Файл не подошёл", en: "The file did not fit", kk: "Файл сәйкес келмеді" },
  messageAria: { ru: "Сообщение", en: "Message", kk: "Хабарлама" },
  stop: { ru: "Остановить", en: "Stop", kk: "Тоқтату" },
  stopShort: { ru: "Стоп", en: "Stop", kk: "Тоқта" },
  send: { ru: "Отправить", en: "Send", kk: "Жіберу" },
  aiPick: { ru: "ИИ", en: "AI", kk: "ЖИ" },
  reasonOn: { ru: "Ход мысли включён", en: "Reasoning is on", kk: "Ой өрбітуі қосулы" },
  reasonOff: { ru: "Ход мысли выключен", en: "Reasoning is off", kk: "Ой өрбітуі өшірулі" },
  askOn: { ru: "Уточняющие вопросы включены", en: "Follow-up questions are on", kk: "Нақтылау сұрақтары қосулы" },
  askOff: { ru: "Уточняющие вопросы", en: "Follow-up questions", kk: "Нақтылау сұрақтары" },
  guestLeft: {
    ru: "Осталось {left} из {limit}",
    en: "{left} of {limit} left",
    kk: "{limit} ішінен {left} қалды",
  },
  bannedBuiltin: {
    ru: "Аккаунт заблокирован. Встроенный чат для этого входа закрыт.",
    en: "This account is blocked. The built-in chat is closed for this sign-in.",
    kk: "Аккаунт бұғатталған. Осы кіру үшін ішкі чат жабық.",
  },
  promptLocked: {
    ru: "Для «{name}» задан общий текст. В чат уходит он, личный промпт с ним не смешивается.",
    en: "“{name}” has a shared text. The chat sends that, and a personal prompt is not mixed in.",
    kk: "«{name}» үшін ортақ мәтін берілген. Чатқа сол кетеді, жеке промпт оған қосылмайды.",
  },
  interestsGeneral: { ru: "Пока общие", en: "Still general", kk: "Әзірге жалпы" },
  personaFailed: { ru: "Не удалось включить персонажа", en: "Could not turn the character on", kk: "Кейіпкерді қосу болмады" },
  thisModel: { ru: "этого ИИ", en: "this AI", kk: "осы ЖИ" },
} as const;

export type UiKey = keyof typeof UI;

export function ui(lang: Lang, key: UiKey): string {
  return UI[key][lang];
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

export type FaqItem = { q: string; a: string };
export type CopyBlock = { title: string; paragraphs: string[] };

const ABOUT: Record<Lang, { title: string; description: string; lead: string; blocks: CopyBlock[]; legal: CopyBlock[]; faq: FaqItem[] }> = {
  ru: {
    title: "О проекте — чат с ИИ — vvvion.space",
    description: "vvvion.space: чат с ИИ, круг, книги, диск и вубли. Вопросы, журнал изменений и условия сервиса.",
    lead: "vvvion.space — чат с ИИ и круг рядом с ним. Здесь спрашивают ИИ, пишут друзьям, читают, смотрят, держат файлы и пользуются внутренними вублями. Сервис для людей старше 18 лет.",
    blocks: [
      {
        title: "Чат с ИИ",
        paragraphs: [
          "Можно выбрать встроенную модель или подключить свой ключ. В ответ входят текст, картинка, поиск по открытым страницам и ход мысли.",
          "В списке модель видна одним названием. Если у неё несколько адресов, сбой одного не показывается отдельным переключением.",
        ],
      },
      {
        title: "Круг",
        paragraphs: [
          "Сообщения, группы, лента, погода, новости, курсы и VPN живут в одном круге. У раздела свой адрес: его можно отправить, и откроется именно он.",
          "Читальня принимает EPUB, FB2, TXT и PDF до 25 МБ. Смотрельня показывает ролики YouTube, Rutube и VK.",
        ],
      },
      {
        title: "Диск, банк и магазин",
        paragraphs: [
          "Диск хранит картинки и голосовые из чата. На папку можно дать ссылку для просмотра и скачать архив целиком.",
          "Вубли — внутренняя мелочь сервиса: карта, перевод другу или по номеру. Их нельзя вывести или обменять на рубли.",
          "В магазине — подписка, место на диске и персонажи для чата с ИИ.",
        ],
      },
    ],
    faq: [
      { q: "Что такое vvvion.space?", a: "Это чат с ИИ и круг: переписка, лента, книги, ролики, диск и банк вублей в одном месте." },
      { q: "Чем чат отличается от круга?", a: "Чат — разговор с ИИ. Круг — люди, записи и сервисы. Оба открываются с главной, у разделов круга есть свои адреса." },
      { q: "Что такое вубли?", a: "Внутренние единицы сервиса. Их нельзя обналичить, вывести или обменять на рубли. Это не электронные деньги." },
      { q: "Можно подключить свой адрес?", a: "Да. В настройках чата добавляется свой адрес и ключ. Встроенный список настраивает администратор." },
      { q: "Как сменить язык?", a: "Откройте меню под аватаркой и выберите русский, английский или казахский. Русский стоит по умолчанию. Выбор запоминается и виден в адресе страницы." },
      { q: "Как поставить на экран?", a: "На Android и компьютере — «Установить приложение» в меню браузера. На iPhone — «Поделиться» и «На экран Домой» в Safari." },
      { q: "Как удалить аккаунт?", a: "В профиле под аватаркой есть удаление. Вместе с аккаунтом уходят вход и связанные с ним материалы этого аккаунта." },
      { q: "Можно ли опираться на ответ ИИ?", a: "Нет. Текст и картинки — автоматическая генерация, не консультация врача, юриста или финансиста и не оферта. Важное проверяйте сами." },
    ],
    legal: [
      {
        title: "Вубли — не деньги",
        paragraphs: [
          "Вубли — внутренние единицы сервиса. Их нельзя обналичить, вывести или обменять на рубли. Это не электронные денежные средства и не перевод денег в смысле Федерального закона от 27.06.2011 № 161-ФЗ «О национальной платёжной системе». Номер карты в банке вублей нужен только чтобы найти участника внутри сервиса.",
        ],
      },
      {
        title: "Персональные данные",
        paragraphs: [
          "Оператор — владелец сервиса vvvion.space. Имя, адрес и отдельная почта для запросов в этом тексте не указаны: их должен опубликовать сам владелец. Пока отдельного контакта нет, запрос на доступ, исправление или удаление данных отправляйте удалением аккаунта в профиле. Обрабатываются данные, которые вы сами оставляете: имя, почта, пароль в защищённом виде, фото профиля, переписка, файлы, книги и технические следы входа, нужные чтобы сервис не ломали. Цели — вход, переписка, диск, банк и безопасность.",
          "Основание — согласие и исполнение соглашения с вами, статья 6 Федерального закона от 27.07.2006 № 152-ФЗ «О персональных данных». Регистрация означает согласие на такую обработку. Согласие можно отозвать, удалив аккаунт: тогда вход и связанные с ним материалы этого аккаунта убираются.",
          "Вы можете попросить показать, исправить или удалить свои данные — это статьи 14 и 21 152-ФЗ. Данные не продаются. Передача возможна только если этого требует закон или если без подрядчика нельзя показать ролик, доставить почту или разместить сервис.",
          "Для граждан России оператор учитывает локализацию по статье 18.5 152-ФЗ и выбирает площадку так, чтобы это требование можно было исполнить.",
        ],
      },
      {
        title: "Ваши файлы и чужие права",
        paragraphs: [
          "Книги, фото, голосовые и ссылка на диск — ваша зона ответственности. Вы гарантируете, что имеете право их показывать. Чужие произведения без разрешения правообладателя размещать нельзя: часть четвёртая Гражданского кодекса Российской Федерации.",
          "Общая ссылка на диск открывает просмотр тому, у кого она есть. Не выкладывайте так чужие тайны и незаконные материалы. Запрещены призывы к насилию, детские запрещённые материалы и иное, что прямо запрещает Федеральный закон от 27.07.2006 № 149-ФЗ «Об информации, информационных технологиях и о защите информации». Если сервису станет известно о таком материале, он его уберёт.",
        ],
      },
      {
        title: "Ответы ИИ и ролики",
        paragraphs: [
          "Текст и картинки ИИ — автоматическая генерация. Это не консультация врача, юриста или финансиста и не оферта. Проверяйте важное сами.",
          "Ролики в смотрельне открываются с YouTube, Rutube и VK. Их правила и реклама остаются правилами этих площадок. Сервис только встраивает плеер.",
        ],
      },
      {
        title: "Право",
        paragraphs: [
          "К сервису применяется право Российской Федерации. Если спор не получится решить перепиской, он рассматривается в порядке, который установлен законом. Потребитель не лишается гарантий Закона РФ от 07.02.1992 № 2300-1 «О защите прав потребителей» там, где этот закон применим к бесплатному информационному сервису.",
          "Настоящий текст — пользовательское соглашение и политика обработки данных. Пользуясь сервисом после публикации этой версии, вы их принимаете.",
        ],
      },
    ],
  },
  en: {
    title: "About — AI chat — vvvion.space",
    description: "vvvion.space: an AI chat, a circle, books, disk and vubles. Questions, the changelog and the service terms.",
    lead: "vvvion.space is an AI chat with a circle beside it. Ask the AI, write to friends, read, watch, keep files and use internal vubles. The service is for people over 18.",
    blocks: [
      {
        title: "AI chat",
        paragraphs: [
          "Pick a built-in model or add your own key. A reply can be text, a picture, a look at open pages, or a line of reasoning.",
          "People see one name in the list. If a model has several addresses, a failure of one is not shown as a switch.",
        ],
      },
      {
        title: "Circle",
        paragraphs: [
          "Messages, groups, the feed, weather, news, rates and VPN live in one circle. Each section has an address: send it and that section opens.",
          "The shelf takes EPUB, FB2, TXT and PDF up to 25 MB. The player shows YouTube, Rutube and VK.",
        ],
      },
      {
        title: "Disk, bank and shop",
        paragraphs: [
          "The disk keeps pictures and voice from the chat. A folder can be shared for viewing, and the archive downloads as a whole.",
          "Vubles are the service’s internal change: a card, a transfer to a friend or by number. They cannot be withdrawn or exchanged for rubles.",
          "The shop has a plan, disk space and characters for the AI chat.",
        ],
      },
    ],
    faq: [
      { q: "What is vvvion.space?", a: "An AI chat and a circle: messages, a feed, books, video, a disk and a vuble bank in one place." },
      { q: "How is the chat different from the circle?", a: "The chat is a conversation with the AI. The circle is people, posts and services. Both open from the home page, and circle sections have their own addresses." },
      { q: "What are vubles?", a: "Internal units of the service. They cannot be cashed out, withdrawn or exchanged for rubles. They are not electronic money." },
      { q: "Can I connect my own address?", a: "Yes. Chat settings take your own address and key. The built-in list is set by an administrator." },
      { q: "How do I change the language?", a: "Open the menu under the avatar and choose Russian, English or Kazakh. Russian is the default. The choice is remembered and shown in the page address." },
      { q: "How do I add it to the home screen?", a: "On Android and desktop, use Install app in the browser menu. On iPhone, Share in Safari, then Add to Home Screen." },
      { q: "How do I delete my account?", a: "Deletion is in the profile under the avatar. Signing in and the materials tied to that account go with it." },
      { q: "Can I rely on an AI answer?", a: "No. Text and pictures are generated automatically. They are not medical, legal or financial advice and not an offer. Check what matters yourself." },
    ],
    legal: [
      {
        title: "Vubles are not money",
        paragraphs: [
          "Vubles are internal units of the service. They cannot be cashed out, withdrawn or exchanged for rubles. They are not electronic money and not a money transfer under Russian Federal Law No. 161-FZ of 27 June 2011 on the national payment system. A card number in the vuble bank only helps find a member inside the service.",
        ],
      },
      {
        title: "Personal data",
        paragraphs: [
          "The operator is the owner of vvvion.space. A name, address and a separate email for requests are not in this text: the owner has to publish them. Until there is a separate contact, ask for access, correction or deletion by deleting the account in the profile. The service processes what you leave yourself: name, email, a protected password, profile photo, messages, files, books and the technical traces of sign-in that keep the service from being broken. The purposes are sign-in, correspondence, the disk, the bank and security.",
          "The basis is consent and performing the agreement with you, article 6 of Russian Federal Law No. 152-FZ of 27 July 2006 on personal data. Registration is consent to that processing. Consent can be withdrawn by deleting the account: sign-in and the materials tied to that account are then removed.",
          "You can ask to see, correct or delete your data — articles 14 and 21 of 152-FZ. Data is not sold. It is passed on only if the law requires it, or if a contractor is needed to show a video, deliver mail or host the service.",
          "For people in Russia the operator takes localization under article 18.5 of 152-FZ into account and chooses a platform so that requirement can be met.",
        ],
      },
      {
        title: "Your files and other people's rights",
        paragraphs: [
          "Books, photos, voice notes and a disk link are your responsibility. You confirm you have the right to show them. Other people's works cannot be posted without the rightsholder's permission: part four of the Civil Code of the Russian Federation.",
          "A shared disk link opens viewing for whoever has it. Do not put other people's secrets or illegal material there. Calls for violence, prohibited material involving children, and anything else directly banned by Russian Federal Law No. 149-FZ of 27 July 2006 on information are forbidden. If the service learns of such material, it removes it.",
        ],
      },
      {
        title: "AI replies and video",
        paragraphs: [
          "AI text and pictures are generated automatically. They are not medical, legal or financial advice and not an offer. Check what matters yourself.",
          "Video opens from YouTube, Rutube and VK. Their rules and ads stay theirs. The service only embeds the player.",
        ],
      },
      {
        title: "Law",
        paragraphs: [
          "The law of the Russian Federation applies to the service. If a dispute cannot be settled in writing, it is heard in the way the law sets. A consumer does not lose the guarantees of Russian Law No. 2300-1 of 7 February 1992 on consumer protection where that law applies to a free information service.",
          "This text is the user agreement and the data processing policy. Using the service after this version is published means you accept them.",
        ],
      },
    ],
  },
  kk: {
    title: "Жоба туралы — ЖИ-мен чат — vvvion.space",
    description: "vvvion.space: ЖИ-мен чат, шеңбер, кітап, диск және вубль. Сұрақтар, өзгеріс журналы және қызмет шарттары.",
    lead: "vvvion.space — ЖИ-мен чат және қасындағы шеңбер. Мұнда ЖИ-ден сұрайды, достарға жазады, оқиды, қарайды, файл сақтайды және ішкі вубльді қолданады. Қызмет 18-ден асқан адамдарға арналған.",
    blocks: [
      {
        title: "ЖИ-мен чат",
        paragraphs: [
          "Ішкі модельді таңдауға немесе өз кілтіңізді қосуға болады. Жауапта мәтін, сурет, ашық беттерден іздеу және ой өрбітуі бар.",
          "Тізімде модель бір атаумен көрінеді. Бірнеше мекенжайы болса, біреуінің қатесі бөлек ауысу болып көрінбейді.",
        ],
      },
      {
        title: "Шеңбер",
        paragraphs: [
          "Хабарлама, топ, таспа, ауа райы, жаңалық, бағам және VPN бір шеңберде. Әр бөлімнің мекенжайы бар: жіберсеңіз, сол бөлім ашылады.",
          "Сөре EPUB, FB2, TXT және 25 МБ-қа дейінгі PDF алады. Ойнатқыш YouTube, Rutube және VK көрсетеді.",
        ],
      },
      {
        title: "Диск, банк және дүкен",
        paragraphs: [
          "Диск чаттағы сурет пен дауысты сақтайды. Қапшыққа қарау үшін сілтеме беруге, мұрағатты тұтас жүктеуге болады.",
          "Вубль — қызметтің ішкі ұсақ бірлігі: карта, досқа немесе нөмірге аударым. Оны шығаруға және рубльге айырбастауға болмайды.",
          "Дүкенде жазылым, дискідегі орын және ЖИ чатына арналған кейіпкер бар.",
        ],
      },
    ],
    faq: [
      { q: "vvvion.space деген не?", a: "Бұл ЖИ-мен чат және шеңбер: хабарлама, таспа, кітап, бейне, диск және вубль банкі бір жерде." },
      { q: "Чат шеңберден несімен басқа?", a: "Чат — ЖИ-мен сөйлесу. Шеңбер — адамдар, жазбалар және қызметтер. Екеуі де басты беттен ашылады, шеңбер бөлімдерінің өз мекенжайы бар." },
      { q: "Вубль деген не?", a: "Қызметтің ішкі бірлігі. Оны қолма-қол ала алмайсыз, шығара алмайсыз және рубльге айырбастай алмайсыз. Бұл электрондық ақша емес." },
      { q: "Өз мекенжайымды қоса аламын ба?", a: "Иә. Чат баптауына өз мекенжайыңыз бен кілтіңіз қосылады. Ішкі тізімді әкімші орнатады." },
      { q: "Тілді қалай ауыстырамын?", a: "Аватар астындағы мәзірден орыс, ағылшын немесе қазақ тілін таңдаңыз. Әдепкісі — орыс. Таңдау сақталады және бет мекенжайында көрінеді." },
      { q: "Экранға қалай қоямын?", a: "Android пен компьютерде браузер мәзіріндегі «Қолданбаны орнату». iPhone-да Safari ішінде «Бөлісу», содан кейін «Үй экранына»." },
      { q: "Аккаунтты қалай жоямын?", a: "Жою аватар астындағы профильде. Онымен бірге кіру және сол аккаунтқа байланған материал кетеді." },
      { q: "ЖИ жауабына сенуге бола ма?", a: "Жоқ. Мәтін мен сурет автоматты түрде жасалады. Бұл дәрігер, заңгер немесе қаржышы кеңесі емес және оферта емес. Маңыздыны өзіңіз тексеріңіз." },
    ],
    legal: [
      {
        title: "Вубль — ақша емес",
        paragraphs: [
          "Вубль — қызметтің ішкі бірлігі. Оны қолма-қол ала алмайсыз, шығара алмайсыз және рубльге айырбастай алмайсыз. Бұл электрондық ақша емес және 2011 жылғы 27 маусымдағы № 161-ФЗ «Ұлттық төлем жүйесі туралы» заңы мағынасындағы ақша аударымы емес. Вубль банкіндегі карта нөмірі қатысушыны қызмет ішінен табу үшін ғана керек.",
        ],
      },
      {
        title: "Дербес дерек",
        paragraphs: [
          "Оператор — vvvion.space қызметінің иесі. Аты, мекенжайы және сұрауға арналған бөлек поштасы бұл мәтінде жоқ: оны иесі өзі жариялауы керек. Бөлек байланыс болмаса, дерекке қол жеткізу, түзету немесе жою туралы өтінішті профильдегі аккаунтты жою арқылы жіберіңіз. Өзіңіз қалдырған дерек өңделеді: есім, пошта, қорғалған құпия сөз, профиль суреті, хат алмасу, файл, кітап және қызметті бұзбау үшін керек кірудің техникалық ізі. Мақсаты — кіру, хат, диск, банк және қауіпсіздік.",
          "Негізі — келісім және сізбен жасалған уағдаластықты орындау, 2006 жылғы 27 шілдедегі № 152-ФЗ «Дербес дерек туралы» заңының 6-бабы. Тіркелу — осындай өңдеуге келісім. Келісімді аккаунтты жою арқылы қайтарып алуға болады: сонда кіру және сол аккаунтқа байланған материал алынады.",
          "Дерегіңізді көрсетуді, түзетуді немесе жоюды сұрай аласыз — 152-ФЗ 14 және 21-баптары. Дерек сатылмайды. Ол тек заң талап етсе немесе бейнені көрсету, пошта жеткізу не қызметті орналастыру үшін мердігер керек болса ғана беріледі.",
          "Ресей азаматтары үшін оператор 152-ФЗ 18.5-бабындағы локализацияны ескереді және бұл талапты орындауға болатындай алаңды таңдайды.",
        ],
      },
      {
        title: "Сіздің файл және бөтеннің құқығы",
        paragraphs: [
          "Кітап, фото, дауыс және диск сілтемесі — сіздің жауапкершілігіңіз. Оларды көрсетуге құқығыңыз бар екеніне кепілдік бересіз. Бөтен шығарманы құқық иесінің рұқсатынсыз қоюға болмайды: Ресей Федерациясы Азаматтық кодексінің төртінші бөлігі.",
          "Дискінің ортақ сілтемесін кімде болса, сол қарайды. Бөтеннің құпиясын және заңсыз материалды солай жаймаңыз. Зорлыққа шақыру, балаларға қатысты тыйым салынған материал және 2006 жылғы 27 шілдедегі № 149-ФЗ ақпарат туралы заң тікелей тыйым салған өзге нәрсеге тыйым салынады. Қызмет мұндай материал туралы білсе, оны алып тастайды.",
        ],
      },
      {
        title: "ЖИ жауабы және бейне",
        paragraphs: [
          "ЖИ мәтіні мен суреті — автоматты генерация. Бұл дәрігер, заңгер немесе қаржышы кеңесі емес және оферта емес. Маңыздыны өзіңіз тексеріңіз.",
          "Бейне YouTube, Rutube және VK-дан ашылады. Олардың ережесі мен жарнамасы сол алаңдардікі. Қызмет тек ойнатқышты салады.",
        ],
      },
      {
        title: "Құқық",
        paragraphs: [
          "Қызметке Ресей Федерациясының құқығы қолданылады. Дауды хатпен шеше алмаса, ол заң белгілеген тәртіппен қаралады. Тұтынушы 1992 жылғы 7 ақпандағы № 2300-1 тұтынушы құқығын қорғау туралы заңның кепілдігінен айырылмайды, сол заң тегін ақпараттық қызметке қолданылатын жерде.",
          "Осы мәтін — пайдаланушы келісімі және дерек өңдеу саясаты. Қызметті осы нұсқа жарияланғаннан кейін пайдалансаңыз, оларды қабылдайсыз.",
        ],
      },
    ],
  },
};

export function aboutCopy(lang: Lang) {
  return ABOUT[lang];
}

const HOME: Record<Lang, { title: string; description: string }> = {
  ru: {
    title: "vvvion.space — чат с ИИ и круг",
    description: "Чат с ИИ и круг vvvion.space: сообщения, лента, книги, погода, новости, диск и банк вублей. У каждого раздела свой адрес.",
  },
  en: {
    title: "vvvion.space — AI chat and circle",
    description: "An AI chat and the vvvion.space circle: messages, a feed, books, weather, news, a disk and a vuble bank. Each section has its own address.",
  },
  kk: {
    title: "vvvion.space — ЖИ-мен чат және шеңбер",
    description: "ЖИ-мен чат және vvvion.space шеңбері: хабарлама, таспа, кітап, ауа райы, жаңалық, диск және вубль банкі. Әр бөлімнің өз мекенжайы бар.",
  },
};

export function homeSeo(lang: Lang) {
  return HOME[lang];
}

type PlaceCopy = { name: string; title: string; description: string; lead: string };

const PLACES: Record<string, Record<Lang, PlaceCopy>> = {
  messages: {
    ru: { name: "Сообщения", title: "Сообщения — круг vvvion.space", description: "Личные диалоги, группы, голосовые, стикеры и файлы до 200 МБ в круге vvvion.space.", lead: "Друзья, группы и файлы в одной переписке. Голосовые можно расшифровать, картинку открыть крупно." },
    en: { name: "Messages", title: "Messages — vvvion.space circle", description: "Direct chats, groups, voice notes, stickers and files up to 200 MB in the vvvion.space circle.", lead: "Friends, groups and files in one conversation. Voice can be transcribed, a picture opened large." },
    kk: { name: "Хабарламалар", title: "Хабарламалар — vvvion.space шеңбері", description: "Жеке диалог, топ, дауыс, стикер және 200 МБ-қа дейінгі файл vvvion.space шеңберінде.", lead: "Достар, топ және файл бір хатта. Дауысты мәтінге айналдыруға, суретті үлкен ашуға болады." },
  },
  feed: {
    ru: { name: "Лента", title: "Лента — круг vvvion.space", description: "Записи и ответы круга vvvion.space: текст, картинки и обсуждение.", lead: "Короткие записи тех, с кем вы в круге. Ответ виден под записью, а не в отдельном чате." },
    en: { name: "Feed", title: "Feed — vvvion.space circle", description: "Posts and replies in the vvvion.space circle: text, pictures and discussion.", lead: "Short posts from people in your circle. A reply sits under the post, not in a separate chat." },
    kk: { name: "Таспа", title: "Таспа — vvvion.space шеңбері", description: "vvvion.space шеңберінің жазбасы мен жауабы: мәтін, сурет және талқы.", lead: "Шеңбердегі адамдардың қысқа жазбасы. Жауап бөлек чатта емес, жазбаның астында." },
  },
  play: {
    ru: { name: "Развлечения", title: "Читальня, смотрельня и игры — vvvion.space", description: "Книги, ролики и игры внутри vvvion.space.", lead: "Читальня держит EPUB, FB2, TXT и PDF. Смотрельня показывает ролики по ссылке. В играх заказы сдаются за вубли." },
    en: { name: "Play", title: "Books, video and games — vvvion.space", description: "Books, video and games inside vvvion.space.", lead: "The shelf keeps EPUB, FB2, TXT and PDF. The player shows a video from a link. Games pay orders in vubles." },
    kk: { name: "Ойын-сауық", title: "Кітап, бейне және ойын — vvvion.space", description: "vvvion.space ішіндегі кітап, бейне және ойын.", lead: "Сөреде EPUB, FB2, TXT және PDF. Ойнатқыш сілтемедегі бейнені көрсетеді. Ойында тапсырыс вубльге өтеді." },
  },
  services: {
    ru: { name: "Сервисы", title: "Погода, новости, курсы и VPN — vvvion.space", description: "Погода, новости, курсы и подписка VPN внутри vvvion.space.", lead: "Погода, новости, курсы и VPN." },
    en: { name: "Services", title: "Weather, news, rates and VPN — vvvion.space", description: "Weather, news, rates and a VPN plan inside vvvion.space.", lead: "Weather, news, rates and VPN." },
    kk: { name: "Қызметтер", title: "Ауа райы, жаңалық, бағам және VPN — vvvion.space", description: "vvvion.space ішіндегі ауа райы, жаңалық, бағам және VPN жазылымы.", lead: "Ауа райы, жаңалық, бағам және VPN." },
  },
  disk: {
    ru: { name: "Диск", title: "Диск — картинки и голосовые — vvvion.space", description: "Личный диск vvvion.space: картинки, голосовые, общая ссылка и архив.", lead: "Сюда сами складываются рисунки и голос из чата. Место можно докупить, архив скачивается целиком." },
    en: { name: "Disk", title: "Disk — pictures and voice — vvvion.space", description: "The personal vvvion.space disk: pictures, voice, a shared link and an archive.", lead: "Drawings and voice from the chat land here. Space can be added, the archive downloads as a whole." },
    kk: { name: "Диск", title: "Диск — сурет пен дауыс — vvvion.space", description: "vvvion.space жеке дискі: сурет, дауыс, ортақ сілтеме және мұрағат.", lead: "Чаттағы сурет пен дауыс осында түседі. Орынды қосуға, мұрағатты тұтас жүктеуге болады." },
  },
  bank: {
    ru: { name: "Банк", title: "Банк вублей — vvvion.space", description: "Внутренние вубли vvvion.space: карта, перевод другу или по номеру. Это не деньги.", lead: "Вубли — внутренняя мелочь сервиса, не рубли и не электронные деньги." },
    en: { name: "Bank", title: "Vuble bank — vvvion.space", description: "Internal vvvion.space vubles: a card, a transfer to a friend or by number. Not money.", lead: "Vubles are the service's internal change, not rubles and not electronic money." },
    kk: { name: "Банк", title: "Вубль банкі — vvvion.space", description: "vvvion.space ішкі вублі: карта, досқа немесе нөмірге аударым. Бұл ақша емес.", lead: "Вубль — қызметтің ішкі ұсақ бірлігі, рубль емес және электрондық ақша емес." },
  },
  shop: {
    ru: { name: "Магазин", title: "Магазин — vvvion.space", description: "Подписка, место на диске и персонажи для чата с ИИ.", lead: "Подписка на 30 дней, место на диске и персонажи. Вубли — внутренняя мелочь, не деньги." },
    en: { name: "Shop", title: "Shop — vvvion.space", description: "A plan, disk space and characters for the AI chat.", lead: "A 30-day plan, disk space and characters. Vubles are internal change, not money." },
    kk: { name: "Дүкен", title: "Дүкен — vvvion.space", description: "Жазылым, дискідегі орын және ЖИ чатына арналған кейіпкер.", lead: "30 күндік жазылым, дискідегі орын және кейіпкер. Вубль — ішкі ұсақ бірлік, ақша емес." },
  },
};

export function placeCopy(slug: string, lang: Lang): PlaceCopy | undefined {
  return PLACES[slug]?.[lang];
}
