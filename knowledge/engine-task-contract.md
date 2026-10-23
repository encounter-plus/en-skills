# Контракт задания: `window.EN` и разметка движка

Область: **modern gameplay / EN+ Kotlin**. Host выбирает этот контракт для demo.en.cx. Для legacy/RN используйте [legacy browser](scripting/legacy-browser.md) и [RN](scripting/legacy-enplus-react-native.md); гарантии window.EN ниже на них не распространяются.

Документ для авторов игр: на что скрипту внутри задания, подсказки или бонуса можно опираться, а на что нельзя. Версия контракта — `EN.version`, сейчас **1**.

## Коротко

- Данные уровня берутся из `window.EN`, а **не** запросом `?json=1`.
- jQuery движок не подключает. Скрипты пишутся на ванильном JS.
- Разметка гарантируется только на классической игровой странице; `window.EN` одинаков на всех клиентах.

## `window.EN`

Объект появляется до того, как выполнится первый скрипт задания, поэтому `EN.getState()` доступен сразу.

```javascript
EN.version            // 1 — версия контракта
EN.getState()         // снимок состояния или null, если уровень ещё не пришёл
EN.subscribe(fn)      // → функция отписки; fn(state) на каждое обновление
EN.ready              // Promise<state> — для скриптов, стартующих раньше данных
EN.serverTime()       // мс эпохи; та же шкала, что у меток в состоянии
EN.urls               // { base, api } — абсолютные адреса, без «относительно страницы»
EN.answer(text)       // → Promise<{ ok, answer }>
EN.bonus(text)        // → Promise<{ ok, answer }>
EN.takeHelp(id, opts) // → Promise<state>; opts.confirm — подтверждение штрафной
```

Снимок заморожен (`Object.freeze`): менять его нельзя, движок отдаёт новый объект на каждое обновление.

### Состояние

```javascript
{
  game:  { id, number, title, zoneId, sequence },
  team:  { id, name, userId, login },
  level: {
    id, number, name,
    startedAt,            // мс эпохи или null
    deadlineAt,           // мс эпохи, момент таймаута, или null
    isPassed, isDismissed,
    sectorsLeft,
    sectors: [{ id, name, isAnswered, answer, answeredBy, answeredAt }],
    helps:   [{ id, number, text, openAt, isPenalty, penaltySeconds,
                requiresConfirm, status }],   // status: closed | requested | open
    bonuses: [{ id, number, name, text, awardSeconds, isAnswered }],
  },
  levels: [{ id, number, name, isPassed, isCurrent }],   // полоса уровней штурма
}
```

Время — **метки, а не остаток**: сервер присылает «осталось N секунд», движок превращает это в момент по шкале `EN.serverTime()`. Таймер рисуется локально:

```javascript
const { level } = EN.getState()
setInterval(() => {
  const left = Math.max(0, level.deadlineAt - EN.serverTime())
  box.textContent = Math.round(left / 1000) + ' с'
}, 1000)
```

### События

Все — `CustomEvent` на `document`. В `detail` всегда лежит текущий `level`.

| Событие | Когда | `detail` |
| --- | --- | --- |
| `en:state` | любое обновление состояния | весь снимок |
| `en:level` | сменился уровень | `{ level, previousLevelNumber }` |
| `en:sector` | закрыт сектор | `{ level, sector }` |
| `en:help` | открылась подсказка | `{ level, help }` |
| `en:bonus` | взят бонус | `{ level, bonus }` |

```javascript
document.addEventListener('en:sector', (e) => {
  flash(`Закрыт сектор: ${e.detail.sector.name}`)
})
```

### Действия

```javascript
const { ok } = await EN.answer('код')   // ok: true | false | null
```

`ok: null` — сервер не сообщил вердикт (например, ответ ушёл, а состояние с результатом не пришло за 15 секунд). Отправлять ответ подделкой сабмита формы больше не нужно.

Подсказку берут через `EN.takeHelp(id)`. Штрафная с подтверждением требует двух шагов — сначала запрос, потом подтверждение:

```javascript
const help = EN.getState().level.helps.find((h) => h.id === id)
await EN.takeHelp(id)                       // status → 'requested'
if (help.requiresConfirm) {
  await EN.takeHelp(id, { confirm: true })  // status → 'open', текст открыт
}
```

Промис резолвится следующим снимком состояния — вердикта у этого действия нет.

## Разметка

Гарантируется **только на классической игровой странице**. Остальные клиенты обязаны отдавать одинаковый `window.EN`, но не одинаковый DOM — на разметку в универсальных виджетах опираться нельзя.

| Узел | Селектор |
| --- | --- |
| Форма ответа | `[data-en="answer-form"]` |
| Поле ответа | `[data-en="answer-input"]` (он же `#Answer`, `name="LevelAction.Answer"`) |
| Форма бонуса | `[data-en="bonus-form"]` |
| Поле бонуса | `[data-en="bonus-input"]` (он же `#BonusAnswer`, `name="BonusAction.Answer"`) |
| Заголовок уровня | `[data-en="level-title"]` |
| Контейнер секторов | `[data-en="sectors"]` |
| Идентификатор уровня | `input[name="LevelId"]` |
| Номер уровня | `input[name="LevelNumber"]` |

Всё остальное — верстка, классы, порядок узлов — может измениться в любой момент без предупреждения.

Координаты: элемент с классом `coords`, внутри — «широта, долгота». Движок сам оборачивает его ссылкой на карты и кнопкой «Копировать».

При подготовке заданий и подсказок в этом проекте оборачивайте выдаваемые игрокам координаты в `<coords>` с этим классом:

```html
<coords class="coords" data-name="Парковка">55.755800, 37.617300</coords>
```

Так оформляются также входы, повороты и точки ожидания. `<span class="coords">` сохраняет документированный класс и допустим в существующих заданиях. Не добавляйте HTML внутрь скриптов, JSON, URL или координатных ответов.

## Ссылки и адреса

Относительные адреса в задании разрешаются относительно адреса страницы, а он у каждого клиента свой. Поэтому:

- файлы игры — абсолютным путём: `/data/games/{gameId}/picture.jpg`;
- собственные запросы — от `EN.urls.base`;
- `?json=1` **не использовать**: движок его не перехватывает, а на неклассических клиентах такой запрос уходит не туда. При попытке в консоли появится предупреждение с указанием, чем заменить.

## jQuery

Движок jQuery не подключает и не будет. Задания переписываются на ванильный JS; в зонах с политикой «только DOM» сеть запрещена целиком, поэтому подтянуть библиотеку с CDN там всё равно нельзя.

| Было | Стало |
| --- | --- |
| `$('#id')` | `document.getElementById('id')` |
| `$('.cls')` | `document.querySelectorAll('.cls')` |
| `$(el).html(x)` | `el.innerHTML = x` |
| `$(el).text(x)` | `el.textContent = x` |
| `$(el).on('click', fn)` | `el.addEventListener('click', fn)` |
| `$(el).addClass('a')` | `el.classList.add('a')` |
| `$.ajax` / `$.get` | `fetch` |
| `$(document).ready(fn)` | просто `fn()` — скрипт выполняется после вставки узла |
| `$.getJSON(url + '?json=1')` | `EN.getState()` |

## Что мы обещаем и что нет

Ломающие изменения формы состояния — только со сменой `EN.version` и заранее объявленным сроком. Внутренний протокол движка (WebSocket, REST) публичным контрактом **не является**: он меняется без предупреждения, и опираться на него нельзя.

Источник: [контракт движка Encounter](https://demo.en.cx/docs/engine-task-contract.html). При проверке 2026-10-15 доступность страницы не подтверждена. Этот файл — локальная копия контракта v1; наличие ссылки не означает проверку текущего сайта. При изменении версии запросите актуальный контракт, а недоступность источника отметьте явно.
