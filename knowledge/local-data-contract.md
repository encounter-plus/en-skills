# Контракт локальных данных

Это вход локальных validate/audit/photo-compare, а не wire DTO Encounter. Все идентификаторы, названия и ответы примеров синтетические; сетевые запросы не выполняются. Значения API сначала сопоставляют явно, неизвестные настройки оставляют нерешёнными.

## GameDraft

Все перечисленные поля обязательны; лишние поля отклоняются. schemaVersion — 1; gameId/domain — непустые строки; title — строка (может быть пустой); phase — draft/live/finished; format — field/virtual/mixed. levels — массив уровней. kind уровня — search/logic/solyanka/transit/pause. answerFormat — строка либо null; autoPassSeconds — неотрицательное целое либо null (отключён); requiredSectors — неотрицательное целое либо null (все); playersStarted — boolean либо null (неизвестно). helps содержат id/text и неотрицательный целый afterSeconds. sectors содержат id и массив непустых строк answers (пустой массив допускается парсером). ID уровней, подсказок и секторов должны быть уникальны в своей области. task, title уровня, text подсказки и строковый answerFormat могут быть пустыми; аудит отдельно проверяет качество и достижимость настроек. Коды сохраняются буквально.

```json
{
  "schemaVersion": 1,
  "gameId": "synthetic-game-001",
  "domain": "synthetic.invalid",
  "phase": "draft",
  "format": "field",
  "title": "Синтетическая учебная игра",
  "levels": [
    {
      "id": "synthetic-level-001",
      "title": "Проверка учебного кода",
      "kind": "search",
      "task": "Найдите учебную надпись. ФО: код без префикса.",
      "answerFormat": "код без префикса",
      "autoPassSeconds": 600,
      "requiredSectors": 1,
      "playersStarted": false,
      "helps": [
        {
          "id": "synthetic-help-001",
          "text": "Посмотрите на учебную карточку.",
          "afterSeconds": 300
        }
      ],
      "sectors": [
        {
          "id": "synthetic-sector-001",
          "answers": [
            "synthetic-answer-001"
          ]
        }
      ]
    }
  ]
}
```

## Наблюдения по фото

Массив PhotoObservation. Все поля примера обязательны; image — ссылка/идентификатор свидетельства, а не прочитанное изображение. reading — clear/ambiguous/unreadable; transcription и documentCode — строка либо null; alternatives — массив строк. mappingVerified/currentMarkingVerified — boolean, которые выставляют только по доказательствам. Этот учебный пример не подтверждает реального нанесения.

```json
[
  {
    "id": "synthetic-observation-001",
    "image": "synthetic-reading-example-no-real-photo",
    "gameId": "synthetic-game-001",
    "domain": "synthetic.invalid",
    "levelId": "synthetic-level-001",
    "sectorId": "synthetic-sector-001",
    "reading": "clear",
    "transcription": "synthetic-answer-001",
    "alternatives": [],
    "mappingVerified": true,
    "currentMarkingVerified": true,
    "documentCode": "synthetic-answer-001"
  }
]
```

## Локальные изменения

План поддерживает только task и answerFormat; before должен буквально совпадать с текущим значением. Применение возможно только при playersStarted:false, результат сохраняется отдельно.

```json
{
  "schemaVersion": 1,
  "mode": "local-draft",
  "gameId": "synthetic-game-001",
  "domain": "synthetic.invalid",
  "edits": [
    {
      "levelId": "synthetic-level-001",
      "field": "task",
      "before": "Найдите учебную надпись. ФО: код без префикса.",
      "after": "Учебное задание. ФО: synthetic-answer-001.",
      "reason": "Синтетический пример уточнения текста"
    }
  ]
}
```
