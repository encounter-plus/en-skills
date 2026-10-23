# Инструменты и интеграции en-skills

Команды ниже выполняются из корня checkout en-skills. Начало работы и список скиллов — в [README](../README.md), установка — в [инструкции](install.md).

## Пересчёт после игры

`game-recalculation` читает полный мониторинг через SDK, рассчитывает время/бонусы скриптом и предлагает таблицу для подтверждения. Пересчёт уничтоженного кода — выбор автора, а не обязательное правило. При слёте показываются количество/доля прошедших на момент инцидента и вопрос о среднем или снятии.

```powershell
npm run en-recalculate -- read --domain demo.en.cx --game ID --level DB_ID --out evidence.json
npm run en-recalculate -- calculate --evidence evidence.json --rules incident.json --out calculation.json
npm run en-recalculate -- report --input calculation.json --out table.md
npm run en-recalculate -- propose --evidence evidence.json --rules incident.json --out plan.json
```

После подтверждения человеком конкретной таблицы host записывает approval по хешу плана и запускает apply. CLI, примеры rule, журнал, read-back и MCP-инструменты описаны в [процессе](../knowledge/recalculation-workflow.md), [правилах](../knowledge/recalculation-rules.md) и [контракте](../knowledge/recalculation-api.md). Есть экспорт CSV (`report --format csv`) и независимый Python math-скрипт в собранном скилле. SDK входит в npm-архив; соседний checkout при установке не требуется.


## Бесплатный расчёт маршрутов

`calculate_route` в MCP считает автомобильный или пеший маршрут через бесплатный тариф openrouteservice. Для CLI/MCP задайте свой бесплатный ключ в `ORS_API_KEY`. Ключ не передаётся модели. Расчёт возвращает дорожное расстояние и примерное время **без пробок**, без платного fallback и без изменений игры. [Правила и формат входа](../knowledge/travel-levels.md#расчёт).

```powershell
npm run en-author -- route --input route.json --out route-result.json
```

В `route.json`: `{"origin":{"latitude":55.7558,"longitude":37.6173},"destination":{"latitude":55.817,"longitude":37.4416},"mode":"driving"}`. Для парковки → вход задайте `walking`; особые повороты задаются координатами в `via`.


## Чтение Google по открытой ссылке

```powershell
npm run en-author -- google-public --url "https://docs.google.com/spreadsheets/d/ID/edit#gid=0" --out source.json
```

OAuth не нужен. Для всей игры используйте google-public-all; google-public читает выбранную часть. Если экспорт недоступен, применяйте [браузерный процесс](../knowledge/google-documents.md), не требуя публикации закрытого документа. Ограничения полноты и вложений учитывайте по результату reader.


## Быстрый запуск

Нужен Node.js 24+. Пакет собирается в JavaScript с декларациями TypeScript; Playwright и esbuild используются автономным стендом скриптов. В checkout можно запускать исходный TypeScript. Для typecheck и разработки установите devDependencies:

```powershell
npm ci
npm run check
npm run en-author -- validate --input examples/game.json
npm run en-author -- audit --input examples/game.json
npm run en-author -- checklist --format field
npm run en-author -- code-variants --code конь6
npm run en-author -- photo-compare --input examples/game.json --observations examples/observations.json
```

[examples/observations.json](../examples/observations.json) содержит синтетический результат чтения, а не настоящее фото и не доказательство качества OCR. `code-variants` показывает гипотезы для визуальной проверки; никакие варианты не принимаются автоматически. Реакцию API на е/ё, регистр и пробелы проверяйте в целевом клиенте.

Локальное исправление в новый файл:

```powershell
npm run en-author -- apply-local --input examples/game.json --plan examples/text-plan.json --out revised.json
```

Выходной файл должен отсутствовать. Это изменение локального текста черновика, не запись в движок. Для моделей и ограничений см. [локальные инструменты](../knowledge/local-tools.md). Административные payload не являются входным GameDraft. Неизвестные fields отклоняются, а не теряются молча.


## Vercel Skills: публикация и обновление

[skills.sh](https://skills.sh/) — каталог навыков из GitHub. По [официальному FAQ](https://skills.sh/docs/faq) он учитывает установки через `npx skills add`; публикация npm-пакета или деплой сайта на Vercel не требуется.

Перед публикацией:

1. Соберите и проверьте `dist/skills`.
2. Подготовьте публичную поставку с `skills/<имя>/SKILL.md` и `skills/<имя>/references/`, взятыми из **собранного** `dist/skills`. Исходные `skills/` нельзя выдавать за такую поставку: CLI переносит каталоги без общего `knowledge/`. Обычный push checkout не включает игнорируемый `dist/`.
3. Опубликуйте самостоятельную поставку в [encounter-plus/en-skills](https://github.com/encounter-plus/en-skills). Если исходники и установочная поставка находятся на разных ветках, указывайте пользователю URL именно установочной ветки; канонические исходники сохраняются отдельно от её generated-копий.
4. Проверьте список и реальную установку выбранного навыка в тестовом клиенте. Команды ниже рассчитаны на самостоятельную поставку в ветке по умолчанию; до её публикации используйте локальный `dist/skills`.
5. После установки проверьте [страницу skills.sh](https://skills.sh/encounter-plus/en-skills). Появление карточки не заменяет проверку ссылок и поведения навыка.

```powershell
npx skills add encounter-plus/en-skills --list
npx skills add encounter-plus/en-skills --agent claude-code --skill game-audit --global
```

Для установки из публичного репозитория обновление выполняется через `npx skills update`. Локальные копии обновляйте повторной сборкой и установкой; ZIP для Claude пересоздавайте и загружайте заново. В ChatGPT builder заменяйте справочники через **Edit Plugin**, затем проверяйте результат в новом чате. Источник команд: [Vercel Skills CLI](https://github.com/vercel-labs/skills).


## Структура и сопровождение

Команды сборки, проверки MCP и обновления снимков: [сопровождение разработчиком](maintenance.md). Этот документ не входит в справочники скиллов.

```text
skills/       исходники SKILL.md со ссылками на knowledge/
knowledge/    каноническое знание и каталог правил
src/          общее ядро, CLI, Encounter/Google/OCR-адаптеры
runtime/      отдельный stdio MCP, свой package.json и тесты
harness/      стенды скриптов, снимки engine/EN+ и стенд анонса
examples/     только синтетические данные
tests/        проверки поведения ядра и CLI
evals/        сценарии для ручных/агентных прогонов
tooling/      сборка и проверка самостоятельности пакетов
docs/         контракты и архитектура интеграций
.claude-plugin/  манифест Claude Code
.codex-plugin/   манифест Codex
plugin.json      общий манифест Agent Plugin
.mcp.json, mcp.json  конфигурации необязательного MCP
dist/skills/  самостоятельные скиллы с генерируемыми references/
dist/codex/   установочная сборка для Codex
dist/claude/  установочная сборка для Claude
dist/knowledge/  скомпилированный каталог authoring-rules.json
dist/*.js, *.d.ts  собранное ядро и CLI
```

Правила редактируются напрямую в `knowledge/authoring-guide.md` и `knowledge/code-marking.md`, включая вводные инструкции и таблицу MARK-02. Это единственные источники правил. `npm run build:skills` собирает из них каталог `dist/knowledge/authoring-rules.json` для CLI; сборка не изменяет исходные Markdown-файлы.

Каждое правило оформляется как `- **RULE-01** — Текст <!-- scope: all -->` под заголовком раздела `##`. ID сохраняйте стабильными. Применимость задаётся комментарием `scope`: `all` либо один или несколько типов `field, virtual, mixed`. Продолжения текста и строки таблиц имеют отступ в два пробела. Все правила носят рекомендательный характер (`advisory`). Маркер `<!-- checklist:introduction:end -->` в руководстве отделяет введение для CLI от остального документа. Сборка проверяет уникальность ID и корректность метаданных.

В исходных `skills/` копий справочников нет. `SKILL.md` ссылается на `../../knowledge/имя.md`. Сборка автоматически обнаруживает каталоги скиллов, проходит зависимости документов и создаёт копии только в `dist/skills/*/references`, переписывая ссылки для автономной установки. Добавление скилла не требует править список в коде. `npm run check` проверяет типы, поведение и пересобирает/валидирует пакеты.

Программное ядро экспортирует `parseGame`, `auditGame`, `comparePhotoCodes`, `suggestCodeVariants`, `parseChangeSet`, `applyLocalChanges`. Бот сможет импортировать эти функции, а собственный agent runtime — загружать выбранный SKILL.md и его справочники. Сетевые адаптеры и загрузчик скиллов экспортируются из корня пакета. Хранилище секретов и agent runtime предоставляет потребитель.


## Использование отдельным ботом

```powershell
npm run build
npm run test:package
npm pack
# В отдельном репозитории бота:
npm install "<en-skills>/encounter-author-tools-0.2.0.tgz"
```

```javascript
import { EncounterClient, PublicGoogleSources, loadSkill } from '@encounter-author/tools';
const skill = await loadSkill('game-audit');
// Передайте skill.instructions агенту; справочники загружайте по необходимости.
const encounter = new EncounterClient({
  domain: 'demo.en.cx',
  token: async () => tokenStore.forCurrentUser('encounter'),
});
const snapshot = await encounter.level('900001', '900002');
```

`tokenStore` здесь обозначает хранилище будущего бота, не готовую функцию пакета. Бот владеет Telegram handlers, пользователями, шифрованными учётными данными, очередями, журналом записей и LLM runtime. en-skills владеет переносимыми инструкциями, знаниями, проверками и API-адаптерами. Для Python-бота доступен тот же CLI с JSON, без копирования правил в bot repo.

Для локальной поставки используйте tarball. `test:package` проверяет установку во временный проект, импорты JS, ресурсы скиллов и CLI.


## Проверка авторских скриптов

[Стенд EN+](../knowledge/script-harness.md) поставляется со снимком WebView runtime и тестовым native bridge. Обновление снимка: `node tooling/snapshot-webview.mjs --enplus-root "ПУТЬ"`. Проверка двух размеров: `node harness/run.mjs --channel chrome`. Собственный HTML: `--html task.html --scenario scenario.json --out artifacts`. Настоящий Encounter проверяется отдельно: `en-engine-check --url https://DOMAIN.en.cx/admin/games/ID/levels/preview/NUMBER --scenario preview.json --allow-actions`. Нужен доступный сайт и его браузерная сессия; адаптер движка и offline fallback не используются.

Редактируйте общий справочник один раз в knowledge/, затем запустите `npm run build:skills`. Устанавливайте каталоги из dist/codex/skills или dist/claude/skills; исходные skills/ предназначены для разработки. npm-пакет и loadSkill используют dist/skills. Каталог dist игнорируется Git.

`node harness/run.mjs --serve` запускает локальный mock server только для EN+. Сохранённые [CSS движка](../knowledge/engine-browser-shell.md) остаются ресурсами анонса; они не используются как runtime Encounter.

Анонсы: [подготовка и poster.png/jpg/gif](../knowledge/announcement-workflow.md), [локальный мок страницы игры](../knowledge/announcement-harness.md). Запуск: `node harness/announcement/run.mjs --channel chrome`; ручной просмотр: `node harness/announcement/run.mjs --serve`.


## Локальный MCP

Общий skill game-author служит точкой входа к специализированным процессам. Канонические знания находятся в knowledge/.

[MCP runtime](../knowledge/mcp-runtime.md) необязателен для использования скиллов. Манифесты указывают на собранные dist/skills; перед установкой выполните `npm run build:skills`, в runtime — `pnpm install --frozen-lockfile` и `pnpm validate`, затем из корня `node tooling/validate-plugin.mjs`. Portable host должен загружать dist/skills, а не исходные skills со ссылками ../../knowledge. Публикация и установка автоматически не выполняются.

Проверки ядра и MCP независимы: `npm run check` и `pnpm --dir runtime validate`. Контрактные проверки внешних сервисов запускаются отдельно на тестовой игре.


## Оптимизация изображений

Локальный `en-image` проверяет вес и разрешение, создаёт отдельные копии JPEG/PNG/WebP с ресайзом и отчётом экономии. Оригиналы не перезаписываются, загрузки в игру нет. [Проверка изображений при аудите и команды](../knowledge/image-optimization.md).


## Переносимые контракты операций

`@encounter-author/tools/authoring-contracts` экспортирует спецификации операций legacy/modern, компилятор переноса таблицы, валидацию исходных ячеек и проверку сохранённого результата. Спецификации используют `AuthoringApiPort`; UI, разрешения, секреты, блокировки и durable storage предоставляет host. Компилятор не знает о чатах.

Сверка кодов (`compareCodes`), чтение заголовков статических PNG/JPEG/WebP (`dimensions`) также доступны через browser-safe `authoring-contracts` и корневой экспорт. Сверка — локальное trim/lowercase-сравнение, не симуляция зачёта движка; исходные строки сохраняются. Декодирование и Canvas остаются в host. Google Docs/Sheets редактируются через браузер по навыку google-documents после одобрения пользователя.
