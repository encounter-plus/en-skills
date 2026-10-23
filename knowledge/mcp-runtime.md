# Локальный MCP runtime

Для локальных Markdown-инструкций и отчётов используй файловые инструменты host (`Read`/`Write`, если доступны). Разрешённый CLI чтения JSON не означает разрешение на произвольные shell-команды: для просмотра файлов не проверяй доступ пробными `Get-Content`, `ls` или `Test-Path`, если shell ограничен allowlist.

На Windows runtime переиспользует скрытый процесс чтения Credential Manager. Каждый запрос вызывает свежее чтение хранилища; значения секретов не кешируются. Ошибка/таймаут процесса завершается ошибкой без возврата старого значения. Это ускоряет проверки сессии при серии операций, не отменяя их. При обновлении runtime синхронизируй также `runtime/scripts/windows-credential.ps1`.

## Содержимое legacy-уровня при переносе

`encounter_read_level_content(gameId, levelId, resource)` читает точную коллекцию или раздел и его `version`. `encounter_write_level_content` принимает те же поля, `expectedVersion` из чтения, `fields` и `confirmed`. Доступны следующие ресурсы:

В чтении `bonuses` большие тексты по умолчанию заменены длиной и SHA-256 в `content_summary`, с явным `texts_omitted: true`; имена, ответы, награды, настройки и версия сохранены. Для буквальной сверки запроси `includeText: true`. Отсутствующий в summary текст не означает пустой текст бонуса.

| resource | Действие записи | fields |
|---|---|---|
| tasks | Создать одно задание | `task_text` (буквальный текст/HTML), `replace_nl_to_br` (boolean), `for_member_id: 0` для всех |
| sectors | Создать один сектор вместе с ответами | `sector_name`, `new_answers` (до 10 буквальных строк одной отправкой); остальные ответы добавляются `encounter_add_answer_alias` в полученный ID |
| bonuses | Создать один бонус | `bonus_name`, `bonus_text` (текст до выполнения), `help_text` (после выполнения), `reward_seconds`, `is_negative`, `all_levels`, `level_ids`, `new_answers` (массив буквальных строк) |
| bonus-create | Создать один бонус без повторного чтения тел всех соседних бонусов | Те же поля; версия относится к шаблону создания и составу ID |
| hints | Создать одну обычную или штрафную подсказку; чтение возвращает `helps` и `penalty_helps` | `help_text`, `timeout` в секундах, `is_penalty`, получатели `for_member_id/for_user_id/for_team_id: 0`; для штрафной также `penalty_comment`, `penalty_time`, `request_penalty_confirm` |
| meta | Изменить название/комментарий | `level_name`, `comment` (только изменяемые поля) |
| autopass | Изменить автопереход | `timeout_hours`, `timeout_minutes`, `timeout_seconds`, `penalty_enabled`, `penalty_hours`, `penalty_minutes`, `penalty_seconds` |
| completion | Изменить условие завершения | `all_sectors: true` или `all_sectors: false, required_sectors_count: N` |

Legacy может не показывать форму условий завершения на пустом уровне или при единственном секторе. После `incomplete-read` не повторяй тот же вызов без изменения состояния: проверь список секторов и доступную форму/превью. При единственном секторе любой из его альтернативных ответов закрывает сектор и весь уровень; переключатель количества обязательных секторов не выводится и не требует записи. Подтверди сам сектор и все альтернативы, не выдумывая прочитанный флаг `all_sectors`. При нескольких секторах не объявляй порог завершения проверенным без читаемой настройки. Недоступность раздела не блокирует независимые задания и бонусы.

## Пакетная запись уровня

Для полного набора секторов и бонусов модель готовит один JSON-план, а host запускает `node runtime/dist/level-import-cli.mjs --plan plan.json --journal journal.json`. Схема `levelImportPlan` находится в `runtime/src/level-import.ts`: domain, gameId, levelId, confirmed, sectors с name/answers, bonusDefaults и полный массив bonuses с sourceKey, fields и/или sourceFields. Источник закрепляется host-переменными `ENCOUNTER_IMPORT_SOURCE` и `ENCOUNTER_IMPORT_SOURCE_SHA256`. План содержит весь ожидаемый состав этих коллекций уровня; неожиданные существующие объекты требуют разбора, а не удаления.

Исполнитель извлекает все исходные значения до первой записи, сверяет существующие объекты, последовательно добавляет недостающее без LLM-вызова на каждый объект и сохраняет журнал. Точные совпадения пропускаются. Отличающийся текст/код существующего бонуса не перезаписывается. Неизвестный исход фиксируется до остановки; повторный запуск не создаёт объект заново, пока предыдущая неопределённая запись не сверена. В конце перечитываются обе коллекции целиком. `status: verified` означает завершённую сверку состава, полей и кодов; отдельная строка progress — только промежуточный результат. Задания, CSS и сообщения оформляются отдельными разрешёнными шагами.

Для серии новых бонусов сначала прочитай `bonuses`, исключи дубли и сохрани mapping. Затем используй `bonus-create`: он проверяет неизменность списка ID и шаблона, точные поля/коды нового бонуса и сохранность его остальных контролов. Тела уже существующих бонусов при каждом добавлении не перечитываются (`sibling-content-not-reread`); это не полная сверка уровня. После серии перечитай `bonuses` с `includeText: true` и сверь весь план. При неизвестном исходе прочитай полную коллекцию перед любым новым созданием.

У бонуса прочитай `creation_template`; `all_levels: false` и `level_ids: [ID]` привязывают его только к нужному уровню. `bonus_text` и `help_text` не взаимозаменяемы. Если исходник задаёт текст, открываемый вводом кода, это `help_text`. Таймеры бонуса меняются только при явной необходимости: `absolute_enabled`, `delay_enabled`, `relative_enabled` и соответствующие значения берутся из прочитанного шаблона/источника. Для автоперехода без штрафа укажи `penalty_enabled: false` и нулевые части штрафа, сохрани отдельно длительность уровня.

Запись сохраняет снимок, проверяет сессию и версию; адаптер сверяет записанные поля и сохранность соседних данных. При `unknown` перечитай ресурс и сопоставь результат с планом; повторное создание вслепую запрещено. Для уже разрешённых пользователем шагов конкретного переноса используй `confirmed: true` без повторного вопроса. Новые несогласованные изменения требуют своего решения. Итоговую сверку всего уровня выполняй отдельно.

Таймаут клиента не доказывает остановку серверного вызова. Host должен передать отмену и дождаться завершения операции либо остановить её процесс, затем выполнить окончательное чтение. Раннее чтение старого значения, пока вызов ещё работает, не разрешает повторную запись. В тестовом хосте лимит ожидания должен учитывать последовательные чтения и сверку legacy-форм; изменение лимита не заменяет обработку неизвестного исхода.

Большие буквальные тексты передавай через `sourceFields` этого же инструмента: соответствие поля JSON pointer в закреплённом хостом источнике, например `{"help_text":"/parts/2/snapshot/rows/3/6","new_answers":"/parts/2/snapshot/rows/3/2"}`. Поле не должно одновременно присутствовать в `fields`. Разрешены `task_text`, `bonus_name`, `bonus_text`, `help_text`, `new_answers`; строка для `new_answers` становится одним элементом массива без разделения и нормализации. Сначала установи смысл ячеек чтением. В плане сохраняй точные пути вместо перепечатки больших HTML-блоков. Host задаёт `ENCOUNTER_IMPORT_SOURCE` и SHA-256 в `ENCOUNTER_IMPORT_SOURCE_SHA256`; изменённый источник блокирует запись. Произвольный файл из аргументов модели не читается.

## Выбор движка и приватная сессия

Registry выбирает demo.en.cx → modern bearer/API + Kotlin, остальные разрешённые Encounter tenants → legacy cookie/form adapter + RN. Modern token и legacy cookies имеют разные типы и отдельные OS credential slots; наличие bearer не аутентифицирует legacy. MCP не принимает пароли, cookies или токены в tool args.

Для legacy host интерактивно импортирует явно разрешённый экспорт browser storage state: `node runtime/dist/cli.mjs auth import-session --profile NAME --input private-browser-storage-state.json`. Исходный файл не копируется в profiles/logs; cookies выбранного tenant хранятся в OS store. Состояние других сайтов отбрасывается. `auth status` сообщает только наличие credential. Import не доказывает вход/права: author principal проверяется при реальном dispatch. Legacy `auth login` не использует guessed password flow.

Если сессия требует исходный браузерный User-Agent, host добавляет в экспорт поле `userAgent` с фактически наблюдённым значением. Импорт сохраняет его вместе с cookies, а транспорт передаёт при проверке principal и каждом запросе. Модель не выбирает и не угадывает этот заголовок. Изменение userAgent меняет binding сессии; отсутствие поля сохраняет прежнее поведение. Проверка входа требует успешного чтения игры, одного `credentialPresent:true` недостаточно.

Standalone `en-author encounter-*` использует временный явный `ENCOUNTER_LEGACY_SESSION_FILE` для legacy или `ENCOUNTER_ACCESS_TOKEN` для modern. Credentials не передаются в аргументах CLI. Runtime process кэширует game-bound legacy port с opaque epoch; новый import/rotation инвалидирует старые bindings. Cross-process старые планы не получают новую сессию автоматически.

Legacy currentBinding — локальная fence без сети. Dispatch сериализован по origin, network starts ограничены минимумом 1s, фиксированные recipes проверяются отдельно от HTTP method (GET тоже может мутировать). Principal проверяется до/после dispatch; cookies не уходят за пределы выбранного HTTPS tenant, redirects/CAPTCHA/auth checkpoints не вызывают скрытый login или retry. Unknown write остаётся unknown. Истечение cookies требует нового разрешённого browser-session import.

Общий port возвращает только поддержанные DTO/операции; partial editor не означает полный backup. Unsupported массивы, live player counts и гарантии остаются unknown/unsupported. Legacy пересчёт по полному monitoring/statistics пока явно unsupported до доказательства полноты; modern процесс пересчёта сохраняется.

Необязательный локальный stdio-сервер для работы с Encounter. Хост определяет доступные инструменты; установка справочника не предоставляет их автоматически.

Read tools: `encounter_profile_status`, `encounter_get_game`, `encounter_list_levels`, `encounter_get_level`, `encounter_get_live_level_state`, `encounter_preview_target`.

Расчёт маршрутов: `calculate_route` — автомобильный или пеший маршрут через openrouteservice; ключ задаёт host через `ORS_API_KEY`. [Вход, результат и ограничения](travel-levels.md#расчёт).

Write tools: `encounter_update_task`, `encounter_update_hint`, `encounter_add_answer_alias`, `encounter_update_answer`, `encounter_move_answer`, `encounter_post_message`, `encounter_dismiss_level`, `encounter_restore_level`, `encounter_delete_sector`.

Для native legacy `forMemberId` — точный неотрицательный ID из свежего списка получателей формы; `0` означает всех. В `encounter_update_task` и `encounter_update_answer` можно передать только получателя без текста: исходный текст и настройка переносов сохраняются. Число само по себе не определяет user/team; DTO сохраняет native `for_member_id` и явный `recipient` с доступными вариантами. `encounter_post_message` принимает `allLevels:true` вместе с явным полным `levelIds` из свежего manager inventory; неполный набор не применяется. `replaceNlToBr` передаёт native checkbox: editor хранит исходные переносы, преобразование относится к отображению.

Native dismiss/restore сохраняет persistent ID и содержимое уровня. Снятие возвращает потраченное время бонусом; восстановление аннулирует этот возврат. `confirmed:true` относится к показанному уровню и этому эффекту. Runtime сохраняет полный manager snapshot, проверяет observed revision, читает native confirmation link, выполняет одну запись и независимо сверяет полную partition уровней. Недоступные current-player statistics остаются unknown.

Для native удаления сектора требуется `confirmed:true` после просмотра точного snapshot сектора и связанных кодов. Unknown live остаётся явно указанным риском; известные current/passed counts сохраняются в результате. Проверяются неизменность соседних секторов и кодов. Modern policy по-прежнему блокирует удаление при неизвестном live или текущих игроках. Extension batch использует ту же человеческую review card и долговечный журнал отдельных native операций; сам пакетный executor не заменяет approval хоста.

CLI использует те же схемы и операции: `node runtime/dist/cli.mjs operation update-answer --profile NAME --input private-input.json`. Допустимы `update-task`, `add-answer-alias`, `update-answer`, `move-answer`, `post-message`, `dismiss-level`, `restore-level`, `delete-sector`. JSON содержит только поля операции (например, `gameId`, `levelId`, `answerId`, `forMemberId`, `confirmed`), без credentials. Проверки scope, confirmation, snapshot и read-back совпадают с MCP; неизвестные записи не повторяются автоматически.

Явный compound workflow `encounter_move_answer` / CLI `move-answer` принимает `gameId`, `levelId`, `answerId`, `sourceSectorId`, `destinationSectorId`, `confirmed:true`. Extension предлагает ту же процедуру одной review card `encounter_propose_answer_move`. Сначала удаляется точный исходный ответ из сектора X, затем в сектор Y того же уровня добавляются его исходный текст и native получатель. Новый ответ получает новый ID, даже если в Y уже есть такой же код. Совпадающие X и Y отклоняются до записи. В snapshot и durable journal остаются исходный ответ, оба inventory, checkpoints удаления/добавления и новый ID при его подтверждении. Между шагами повторно проверяются binding, политика, revision и доступность native получателя.

Эта процедура последовательная и неатомарная. Если удаление подтверждено, а создание не выполнено или осталось неизвестным, результат прямо показывает `sourceDeleted:true`, `changed:true`, состояние создания и путь к journal; успешный перенос не заявляется. При неизвестном факте изменения возвращается `changed:null`. Ошибка удаления не запускает добавление. Нет автоматического повтора, восстановления удалённого ответа или продолжения создания после перезапуска. Read-only reconciliation может подтвердить результат только при сохранённых checkpoints, новом ID и неизменных preservation proofs. Если после аварии новый ID не был установлен, состояние остаётся unknown: host/автор отдельно сверяет текущие native формы с сохранённым текстом и получателем, затем явно решает восстановление или новое создание. Повторный запуск того же compound journal не выполняет записи.

Пересчёт после игры: `encounter_read_recalculation_evidence`, `encounter_inspect_recalculation_evidence`, `encounter_calculate_recalculation`, `encounter_propose_corrections`, `encounter_apply_corrections`, `encounter_verify_corrections`. Используются общий SDK и калькулятор npm-пакета; [процесс](recalculation-workflow.md) требует подтверждения полной таблицы доверенным host. MCP не предоставляет инструмент создания approval.

Профиль содержит apiBaseUrl, webBaseUrl, domain и необязательный previewUrlTemplate. Для modern JWT хранится в системном credential store, пароль используется интерактивно. Legacy хранит отдельную cookie-session запись по процедуре выше. Порядок data directory: ENCOUNTER_DATA_DIR, PLUGIN_DATA, CLAUDE_PLUGIN_DATA, системная пользовательская директория. Секреты не передаются аргументами MCP и не публикуются в чате.

Modern API Encounter фиксирован: `https://api.en.cx`; legacy работает через выбранный HTTPS tenant и form recipes. Игровые поддомены пользователи регистрируют самостоятельно: `moscow.en.cx`, `dozorekb.en.cx` и другие. В браузере `domain` берётся из `location.hostname` игровой страницы, а `webBaseUrl` — из её `location.origin`. Список игровых доменов не фиксируется в конфигурации.

Из корня установленного checkout: `node runtime/dist/cli.mjs profile set development --api-base-url https://api.en.cx --web-base-url https://demo.en.cx --domain demo.en.cx --activate`, затем `node runtime/dist/cli.mjs auth login --profile development`. Адреса здесь пример, не свидетельство доступности сайта. Проверка входа: `node runtime/dist/cli.mjs auth status --profile development`. Сервер: `node runtime/dist/server.mjs`.

Runtime использует общий engine-bound AuthoringApiPort с snapshot/preflight/read-back; modern REST и legacy form recipes имеют разные capabilities. Version-bound apply предоставляет API-адаптер, долговечный журнал обеспечивает хост; runtime не гарантирует идемпотентность записи. Перед использованием в production проверьте request body на отдельной тестовой игре. ENCOUNTER_WRITES_DISABLED=1 блокирует записи; манифесты поставляются с этим ограничением. Снятие ограничения — настройка локального хоста после проверки контракта, не инструкция модели.

Подтверждение confirmed относится к конкретному показанному риску, а не будущим операциям. После неизвестного результата запись не повторяется автоматически. Матрица [live-game.md](live-game.md) и [административный контракт](admin-contract.md) описывают разные уровни проверок; применяется доступный adapter без обхода его ограничений.

Windows использует Credential Manager, Linux — secret-tool, macOS — security CLI. На macOS запись токена передаёт его процессу security через аргумент из-за интерфейса этой утилиты; это ограничение локального backend, а не гарантия отсутствия секрета в списке процессов.


Read-only export tools: encounter_export_snapshot сохраняет приватный local migration-preparation artifact с raw JSON, source binding, consistency rereads и явными coverage gaps. Это не полный backup/restore и не server migration. encounter_file_references и encounter_scenario_export дают partial legacy ссылки/overview; они не читают attachment bytes, не загружают файлы и не назначают poster. Missing inventory links не доказывают пустой storage. Unsupported drafts «Важно»/poster сохраняются отдельно без применения.

### Группировка native-записей

Общий бонус для выбранных уровней создаётся один раз с `all_levels:false` и полным `level_ids` выбранной группы. Не копируй его по одному на каждый уровень и не используй «все уровни», если автор ограничил доступ серией. Текущий `level-import-cli` рассчитан на бонусы одного уровня; для общей коллекции host применяет подготовленный план через `bonus-create` с явным scope и долговечным журналом.

Область доступности бонусов и сообщений организатора проверяй в собственной форме каждого объекта: режим «все уровни» или «на указанных» и точный набор отмеченных уровней. Legacy-адаптер уже возвращает эти значения как `all_levels` и `level_ids`; используй их при итоговой сверке содержимого, читая каждый уникальный объект один раз. Это одновременно подтверждает включённые и исключённые уровни без дополнительного обхода их списков и сравнения одинаковых ID. Для выбранной группы сверяй весь набор, а не только число галочек; режим «все уровни» проверяй отдельно от списка. В просмотре бонуса доступность также указана строкой «Бонус доступен на уровнях». Суффикс «для всех» у ссылки бонуса означает получателей, а не все уровни. Дополнительный обход уровней нужен только при противоречии формы с отображением или отдельной диагностике движка.

При создании сектора передавай `new_answers` вместе с `sector_name`: legacy-транспорт заполняет до 10 наблюдаемых слотов одной формы и сверяет ответы и существующие секторы. Исполнитель уровня использует первые 10 ответов при создании, остальные добавляет последовательно. Существующий сектор дополняется только отсутствующими ответами.

При изменении текста задания или подсказки legacy runtime читает только целевую сущность до и после записи. Не загружай полный редактор со всеми карточками бонусов ради одной правки. Сохраняй проверку ревизии, состояния игры и результата записи; для подсказки номер уровня берётся из списка уровней.

В legacy-command-batch размещай независимые `level.create` подряд: исполнитель объединяет до 20 в одну операцию, сохраняет соответствия ID всех созданных уровней одним checkpoint. Зависимые задания идут после группы. Неопределённая отправка блокирует очередь до сверки.

Низкоуровневый legacy API поддерживает `PUT /admin/games/{gameId}/levels/names` с `{names:[{level_id,level_name}]}` и `X-Authoring-Expected-Revision` свежего списка уровней. Он сохраняет остальные названия и проверяет порядок и ID после одной отправки.

При ошибке сессии останови обращения к retired-транспорту. Хост обновляет ранее разрешённую browser-сессию и запускает новое независимое чтение. Не ищи cookies в артефактах и не заменяй MCP случайными CLI-командами. Продолжение неопределённой записи допускается после явной сверки наличия и содержимого объекта.

`NotHumanRequest.aspx` означает проверку человека, а не обычное истечение сессии. Останови все очереди к домену; хост показывает страницу и следует предложенному сайтом ожиданию или штатному входу. CAPTCHA передаётся пользователю. Не запускай параллельные импортёры и не ускоряй очередь уменьшением интервала запросов после такого ответа. Сначала устрани повторные чтения.

Для оформления нейродиалога хост может подтвердить отсутствие сообщений через редактор: `get_level` имеет неполное покрытие сообщений. Прими такое проверенное наблюдение; не обходи все игровые ресурсы ради повторной проверки. Если пользователь уже разрешил изменение задания, передавай `confirmed:true` при необходимой политикой явной отметке.

## Общий план импорта

`encounter_inspect_import_level`, `encounter_prepare_import_plan`, `encounter_create_level_from_plan`, `encounter_reconcile_import_plan` и `encounter_verify_import_plan` реализуют [единый контракт плана](import-plan.md). Низкоуровневые инструменты остаются для отдельных правок; успешное создание заготовки не подтверждает выполнение плана.
