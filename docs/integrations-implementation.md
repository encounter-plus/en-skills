# Архитектура интеграций

Telegram остаётся самостоятельным репозиторием. npm-пакет поставляет библиотечный API, JSON CLI и переносимые skills. В этом checkout нет Telegram SDK, обработчиков updates, общей базы пользователей или хранилища токенов.

## Encounter

Маршруты и модели административных операций описаны в [контракте адаптера](encounter-adapter-contract.json). Доступность операции и права пользователя проверяются при подключении к выбранной игре.

REST-адаптер использует `@encounter-api/sdk` из зафиксированного переносимого архива в `vendor/`; SDK входит в npm tarball как bundled dependency. Абсолютных ссылок на соседний checkout нет. Сохраняются полные raw DTO и существующий интерфейс `applyLevel`, session gates и редактирование ошибок. Generated группы задают новые операции мониторинга, статистики и corrections; транспорт не повторяет запросы.

applyLevel — низкоуровневый метод: generic fields Swagger недостаточно для автоматической генерации правок всех сущностей. Адаптер проверяет версию и старт игроков, возвращает результаты отдельных операций и выполняет read-back. Устойчивый journal и сравнение результата с before/after относятся к вызывающему приложению. Для PATCH настроек игры клиент не предоставляет отдельного метода.

## Google и OCR

Документация используемых операций:

- [Vision OCR](https://docs.cloud.google.com/vision/docs/ocr): TEXT_DETECTION, inline base64, аннотации.
- [Vision images.annotate](https://docs.cloud.google.com/vision/docs/reference/rest/v1/images/annotate): пакет ответов и ошибки отдельных изображений.

OcrProvider позволяет сменить backend; GoogleVisionOcr выдаёт доказательства для проверки, не подтверждённые ответы.

## Проверка

- `npm run check` — проверка типов, synthetic HTTP/core/CLI tests, сборка JS/declarations и skill-пакетов.
- `npm run test:package` — установка tarball во временный проект без lifecycle-скриптов и сети, проверка импортов, загрузки скиллов, справочников, CLI и локальных стендов.

Тесты используют синтетические HTTP-ответы. Для проверки внешних сервисов отдельно проверьте вход, права автора, запись на тестовой игре. Точность OCR оцените на размеченных фотографиях; качество работы агента — по сценариям в `evals/`.

## Публичные ссылки

PublicGoogleSources и CLI google-public читают Google web export (txt/csv) без токенов. Для редактирования применяется [браузерный процесс с одобрением](../knowledge/google-documents.md). Настройки [доступа по ссылке и скачивания](https://support.google.com/drive/answer/2494822) влияют на доступность экспорта; для Sheets также описано [анонимное чтение открытых таблиц](https://developers.google.com/chart/interactive/docs/spreadsheets). Ограничения экспорта включены в каждый результат.

## Image input как основной путь

OpenAIImageReader вызывает Responses с input_image и JSON schema; модель задаёт хост. ImageReaderWithFallback использует Google OCR при технической ошибке. Отказ, нечитаемость и неоднозначность не вызывают fallback. Документация: [image input](https://developers.openai.com/api/docs/guides/images-vision) и [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
