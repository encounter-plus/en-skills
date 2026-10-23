# Реализованный контракт пересчёта

Источник: зафиксированный Swagger SDK от 2026-10-07, SHA-256 `F58F5F669F48569D7866889A9927F0ED7B17D88CF250C285BED9E57EDF540C0B`. Упакованный TypeScript SDK 0.1.0 имеет SHA-256 `652E3552004846756BD48AC4325BEB343D5AF0A1F3F9FF674FF6252A52270760`; происхождение в vendor manifest. Генерация SDK и реальные игровые записи при реализации не выполнялись.

`src/encounter.ts` использует общий SDK transport. Новые операции строятся generated RequestOpts для `GamesMonitoringApi`, `GamesStatisticsApi`, `GamesPlayersApi`, `GamesResultsApi`. Старый интерфейс чтения редактора и applyLevel сохранён, но HTTP также проходит через SDK. Сеть ограничена центральным API; сохраняются automation/Bearer/domain, session fencing, no retry и bounded raw responses.

Калькулятор получает полные исходные снимки и явное правило. Номер уровня и DB ID проверяются раздельно. Семантика времени и знаков взята из Kotlin `GameStatsParser`/`StatsProcessing`: конец — enter_date_time, исходная длительность — spent_seconds, итоговое время — исходное минус correction_value. Пустая/нулевая .NET-дата не превращается в нормальное прохождение или нулевую исходную длительность.

POST corrections принимает generated camelCase request; SDK сериализует его в wire snake_case. Seconds абсолютные, isBonus выбирает знак. Comment равен утверждённой причине, включая точное «Среднее время на уровне N». Повторное применение, approvals и сверка связываются приватным журналом, а не текстом публичной причины.

Schema создания задаёт только integer map результата. Adapter принимает один однозначный ID и проверяет полную запись GET. При потерянном ответе verify использует baseline IDs и уникальное совпадение нового результата; при неоднозначности остаётся unknown. Серверная атомарность/идемпотентность не обещается. Итоги статистики проверяются отдельно от подтверждения записи.

Standalone: npm включает SDK как bundled dependency; переносимые skill directories включают references, Python math-скрипт и UI metadata.
