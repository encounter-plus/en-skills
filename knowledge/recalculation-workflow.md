# Процесс пересчёта после игры

Начните с причины, если она не названа. Затем уточняйте только недостающие решения: правильный код и объект зачёта, момент исправления/слёта, цепочка ответа, исходный порог, размер бонуса, состав участников и округление. Сохраняйте авторское правило как явный `rule`, а не как догадку модели.

## Доступный npm/CLI

Пакет `@encounter-author/tools` содержит adapters обоих движков, детерминированный калькулятор и CLI `en-recalculate`. Modern: токен автора передаётся через `ENCOUNTER_ACCESS_TOKEN` в окружении host. Legacy: `ENCOUNTER_LEGACY_SESSION_FILE` указывает на явно разрешённый экспорт cookie-сессии выбранного домена; MCP использует импортированный `auth import-session` credential профиля. Секреты не передаются через чат/аргументы. Движок выбирается до запросов; ошибки не вызывают переключение или bearer fallback. Неполные native roster/statistics/final totals блокируют полный снимок, а текущая игра не допускается к предложению записи. См. [native источники и ограничения](recalculation-api.md#legacy).

```text
en-recalculate read --domain DOMAIN --game GAME_ID --level LEVEL_DB_ID --out evidence.json
en-recalculate calculate --evidence evidence.json --rules incident.json --store PRIVATE_DIRECTORY --out calculation.json
en-recalculate report --input calculation.json --out table.md
en-recalculate propose --evidence evidence.json --rules incident.json --store PRIVATE_DIRECTORY --out plan.json
en-recalculate report --input plan.json --out confirmed-table.md
```

`propose` создаёт неизменяемый план с `id` SHA-256, таблицей, точными payload и хешем evidence. Только после подтверждения человеком полной таблицы host фиксирует approval:

```text
en-recalculate approve --plan plan.json --confirmed-table PLAN_SHA256 --store PRIVATE_DIRECTORY
en-recalculate apply --plan plan.json --store PRIVATE_DIRECTORY --out outcome.json
en-recalculate verify --plan plan.json --store PRIVATE_DIRECTORY --out verified.json
```

`approve` — действие доверенного host после ответа автора или нажатия кнопки. Сам факт вычисления SHA-256 не является согласием автора. Агент вызывает его только после фактически полученного подтверждения в разговоре. MCP не предоставляет инструмент создания approval. Каталог store содержит планы, approval и журнал; это приватные локальные данные host. Не храните его в Git или папке общего доступа. После успешного применения перечитайте статистику и сравните итоговые суммы; исходные секунды уровня остаются отдельно от корректировок.

При rejected/unknown дальнейшие строки остаются pending. `verify` только читает и сверяет. Для оставшихся корректировок получают свежие evidence и новый план с тем же incident ID и store: проверенные correct IDs из журнала учитываются автоматически. Unknown сначала сверяются; новый план этого уровня до сверки заблокирован. Новый план подтверждается отдельно. Удаление прежних корректировок/автоматический rollback в этот процесс не входят.

## MCP runtime

Если локальный runtime установлен и настроен, доступны:

- `encounter_read_recalculation_evidence`: полный снимок, `evidenceRef` и опись данных.
- `encounter_inspect_recalculation_evidence`: страницы событий/времён/участников/строк расчёта.
- `encounter_calculate_recalculation`: исполняет формулу по `evidenceRef` и явному rule; возвращает calculationRef, вопросы, долю прошедших и строки таблицы.
- `encounter_propose_corrections`: сохраняет план и возвращает planRef/planFile/store. Покажите все страницы таблицы; первая страница не означает полную проверку.
- `encounter_apply_corrections`: применяет planRef после сохранённого host approval. `confirmed=true` отсутствует. `ENCOUNTER_WRITES_DISABLED=1` запрещает запись.
- `encounter_verify_corrections`: read-back без повторного POST.

Refs привязаны к профилю и сессии. После переключения аккаунта/домена нужны новые evidence и план. Node legacy связывает durable identity с импортированными cookies и проверенным principal; перед/после запросов проверяет смену аккаунта. Runtime использует тот же расчётный модуль и выбранный adapter; его наличие проверяется по реальным tools, а не по установленному SKILL.md.

## Таблица и отчёт

Каждая команда должна иметь строку, включая нулевые изменения и неразрешённые случаи. Для бонусов база `award` означает сумму бонуса, для времени уровня база `elapsed` — исходную длительность. Не сравнивайте их как одинаковые величины.

Покажите формулу, опорные вводы `(tab, action_id)`, доноров среднего, точное среднее, округление и комментарии будущих записей. После подтверждения идентичная таблица не требует повторного вопроса. Изменённое правило, другой набор команд или новые данные создают новый план.

При недоступности полного калькулятора используйте en_skills_math_check, если он объявлен хостом. В отдельно установленном game-recalculation есть Python-ресурс math_check.py, указанный ссылкой в его SKILL.md; копия одного этого справочника скрипт не предоставляет. Этот скрипт проверяет арифметику JSON вида `{"timesSeconds":[60,120,180],"targets":[{"key":"team:1","currentSeconds":150,"targetSeconds":120}]}`. Он возвращает сумму 360, среднее 120 и бонус 30 секунд для синтетического примера; мониторинг не анализирует. Для реальной игры сначала подготовьте доказанные исходные длительности. Невыполненный скрипт не даёт права заявлять вычисленный результат.
