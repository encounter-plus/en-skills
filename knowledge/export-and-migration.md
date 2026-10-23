# Экспорт и подготовка миграции

Получите выбранный host scope и [capabilities](engine-capabilities.md). Различайте readable scenario overview, captured editor JSON и полный backup с settings/IDs/recipients/files. Частичные Task+Hint DTO, пустые неизвестные массивы или GameScenario HTML не являются полным backup.

## Read-only capture

Browser tool `encounter_export_snapshot` принимает optional maxLevels и draftPresentation. Scope/engine берутся только от host. Artifact сохраняет raw JSON каждого успешного чтения, decoded значения без нормализации строк, SHA, opaque source-session fingerprint, engine/domain/game binding, revision semantics и consistency rereads. Превышение cap, failed/unsupported reads и изменённые reread отмечаются явно; после failed source read скрытого retry нет. Это observed collection, не атомарный snapshot/CAS.

Неизвестные native «Важно»/poster и unsupported пользовательские drafts сохраняются отдельно как draftPresentation/applied:false. Их наличие не разрешает записывать guessed поля в другой движок. Artifact содержит completeBackup:false и migration.ready:false с blockers; не называйте его полной резервной копией или готовым restore.

CLI: `en-author encounter-export --domain TENANT --game ID --input presentation-draft.json --out preparation.json`. --input optional. Modern использует bearer host credential; legacy — явно разрешённый browser-session provider. [Приватная сессия Node](mcp-runtime.md). В MCP `encounter_export_snapshot` сохраняет mode0600 artifact и возвращает путь/summary, не credentials.

## Файлы и readable scenario

`encounter_file_references` / `en-author encounter-files` возвращают только observed uploader links и discovered storage base выбранной игры. Нет links не означает пустое хранилище. filename/URL не доказывают bytes, MIME, SHA или отсутствие overwrite race. ResourceBytesRead:false; upload и native poster assignment остаются unavailable до подтверждённого контракта.

`encounter_scenario_export` / `en-author encounter-scenario` сохраняют exact source slices scenarioBlock. Это readable overview; он может опускать stable IDs, recipients и скрытые настройки. Zero blocks не доказывает ноль уровней. Admin form hidden state не экспортируется.

## Перед будущим переносом

Подготовьте явную source→target карту engine/domain/game/entity IDs и номеров уровней; IDs разных движков не эквивалентны. Сверьте все content/settings/recipients, leading zeros, empty/null/false/0, literal author HTML и ответные строки, files/bytes и непереносимые поля. Пользователь отдельно выбирает судьбу unsupported drafts. Неполные данные блокируют автоматический server migration; подготовка local artifact не является применением. Upload/restore/migration требуют отдельного подтверждённого workflow и журнала каждого шага. В текущем capture серверных записей нет.

## Подтверждаемый последовательный batch

Browser tool `encounter_propose_legacy_batch` создаёт обычную immutable review card. Подтверждение человеком разрешает только перечисленные команды: `level.create` (один уровень), `task.create` с literal taskText, `sector.create`, `sector.rename`, `sector.delete`. У каждой команды уникальный id. `levelId:{createdBy:"levelCommandId"}` связывает task/sector с persistent ID, полученным и проверенным после создания уровня; номер уровня не подставляется вместо ID. Структура и capabilities всех команд проверяются до первой записи; новые коллекции можно прочитать только после создания родителя.

Это не full game importer и не автоматическая миграция: неподдерживаемые поля, upload, recipients, bonus/answer/message import, настройка всего уровня и перенос native «Важно»/poster в этот batch не входят. Перед показом карточки получите полный список commands; не скрывайте destructive sector deletion или частичные последствия.

Host сохраняет intent каждого шага до отправки и verified ID mapping после readback. Перед каждым шагом читается свежая observed revision; для ранее прочитанной коллекции она должна совпасть с reviewed snapshot или собственным verified предыдущим результатом. Порядок последовательный, без атомарности и rollback. Conflict/unknown останавливает оставшиеся команды. При сохранённом dispatching после crash результат становится unknown; ни apply, ни read-only reconciliation не повторяет такую команду и не продолжает batch автоматически. Journal остаётся в downloadable plan artifact. Node library предоставляет отдельный private filesystem journal с exclusive lock; публичного MCP/CLI server-write обхода approval нет.
