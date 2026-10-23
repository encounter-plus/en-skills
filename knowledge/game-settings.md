# Настройки игры

Операции `encounter_propose_legacy_game_settings`, `encounter_propose_modern_game_settings` и `encounter_propose_modern_announcement` сохраняют конкретный before/after для проверки пользователем. Host повторно читает снимок перед единственной записью, ведёт durable журнал и проверяет результат независимым чтением. Неопределённую запись не повторяют. Для game PATCH server CAS не подтверждён; modern level apply имеет другой контракт версии.

## Legacy

Чтение — `GET /Administration/Games/GameEditor.aspx?gid=ID&action=edit`, запись — один `POST /Administration/Games/GameEditor.aspx` с полной свежей формой. Модель передаёт только разрешённые settings keys, никогда имена скрытых полей или произвольный payload.

`editable_fields` сообщает доступные в этой форме поля. Отсутствующие, disabled и неоднозначные controls не записываются. Значения всех полей ниже — **точные строки нативной формы**, кроме указанных boolean. Даты сохраняют собственное wall-clock написание формы; без явного часового пояса не преобразуйте их из modern RFC3339.

| Facade key | Нативный control |
|---|---|
| title / authors / descr | GameTitle / GameAuthors / Descr |
| prize / fee / fee_currency_id | Prize / Fee / FeeCurrency |
| start_date_time / finish_date_time / request_last_date | StartDateTime / FinishDateTime / RequestLastDate |
| is_moderated (boolean) | IsModerated radio true/false |
| show_finish_place (boolean) | chkShowFinishPlace |
| is_available_after_finished (boolean) | GameAvailAfter |
| hide_game_descr (boolean) | cbIsGameShortDescrHided |
| hide_players_list / hide_levels_names (boolean) | HidePlayersList / HideLevelsNames |
| hide_game_from_calendar (boolean) | HideGameFromCalendar; это прямое значение скрытия |
| stat_availability_type_id / scenario_availability | GameStatAvailabilityList / GameScenarioAvailabilityList |
| max_players / max_team_members | MaxPlayers / MaxTeamPlayers |
| show_fee / certificate_access_mode | ShowFeeList / CertificateMode |
| certificate_places / not_first_places | FirstPlaces / NotFirstPlaces |
| accept_rate_mode / accept_rate_from_date_time | radioAcceptRateMode / txtAcceptRateFrom |
| author_complexity | ddlAuthorsCompexity |

Select/radio принимают только реальные enabled варианты свежей формы. Checkbox использует прочитанный native value или отсутствие control для false. Сохраняются hidden state, неизвестные поля, повторяющиеся имена, unchecked и disabled controls. После записи сравниваются изменённые значения, структура доступных controls и все неизменённые соседи. Уже начавшаяся игра может скрывать/блокировать StartDateTime; это не разрешение отправить пустое значение.

## Modern

`GET /admin/games/{id}` возвращает game/authors/referees. `PATCH /admin/games/{id}` изменяет только названные поля. Поддерживаются все keys схемы `AdminUpdateGameRequest`, если соответствующее сохранённое значение доступно для read-back:

- Строки: `title`, `descr`, `additional_parameters`, `fee_name`, `for_user_login`, `remove_game_stakes_reason`; даты `start_date_time`, `finish_date_time`, `request_last_date`, `accept_rate_from_date_time` требуют RFC3339 с часовым поясом.
- Boolean: `hide_game_descr`, `hide_levels_names`, `hide_players_list`, `is_available_after_finished`, `is_moderated`, `public_access`, `referee_type`, `replace_nl_to_br`, `show_finish_place`, `show_in_calendar`.
- Integer: `certificate_access_mode`, `certificate_places`, `competition_id`, `display_announcement`, `display_monitoring`, `earn_points_from`, `earn_points_to`, `fee_currency_id`, `for_user_id`, `game_type_id`, `incomplete_task_penalty_sec`, `level_complete_type_id`, `levels_sequence_id`, `max_distance`, `max_players`, `max_team_members`, `measure_type_id`, `price_cents`, `prize_cents`, `prize_type`, `scenario_availability`, `show_fee`, `stat_availability_type_id`, `zone_id`.
- `afc`: число 0..1 с шагом 0.1; legacy author_complexity использует собственные значения 0..10.
- `authors`, `referees`: полный массив `{login}` или `{user_id}`, один способ идентификации на элемент.

Для price_cents/prize_cents read-back проверяет `game.price`/`game.prize` без пересчёта единиц. Командные write-only поля без читаемого результата отклоняются до отправки, даже если есть в Swagger. Числа enum без подтверждённого смысла нельзя назначать по догадке; берите точное решение автора и прочитанные значения. Тип игры и zone не выходят за пределы поддерживаемых этим пакетом «Схватки» и «Точек».

## Публикация анонса

Modern announcement proposal записывает `descr` и явно выбранные `replace_nl_to_br`, `hide_game_descr`, `display_announcement`. Он не угадывает смысл display enum и не меняет другие настройки. `from_author_text` — другое поле чтения; публикация descr не подтверждает его изменение. Загрузка файла не подтверждает назначение постером: используйте отдельный проверенный контракт. Для подготовки постера примените [процесс анонса](announcement-workflow.md).
