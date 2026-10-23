# Контракт анонса: снимок SDK

Область SDK paths и server version ниже — modern adapter. Для legacy примените [capabilities и ограничения](engine-capabilities.md); одинаковый facade JSON не подтверждает underlying endpoints или CAS.

Сверено с локальным снимком en-plus-kotlin/encounterSdk/spec/upstream/swagger.json; источник https://api.en.cx/swagger/doc.json, fetchedAt 2026-10-07T00:15:28.153Z. Это структура контракта, не live-проверка. Переносимый справочник содержит нужные поля целиком; исходный checkout для его чтения не требуется.

## Поля чтения

GET /games/{id}/details возвращает GameDetails. descr и from_author_text — разные поля; read DTO не задаёт способ записи анонса. Ниже фрагменты схем, а не полный ответ сервера.

```json
{
  "models.GameDetails": {
    "from_author_text": {
      "type": "string"
    },
    "game": {
      "$ref": "#/definitions/models.Game"
    },
    "is_from_author_visible": {
      "type": "boolean"
    }
  },
  "models.Game": {
    "descr": {
      "type": "string"
    },
    "poster_url": {
      "description": "PosterURL — data/games/{id}/poster.{png,jpg,gif} для карточки на главной.",
      "type": "string"
    },
    "start_date_time": {
      "type": "string",
      "format": "date-time"
    },
    "title": {
      "type": "string"
    }
  }
}
```

## Загрузка файла

POST /admin/games/{id}/files — multipart/form-data, обязательные path id (integer) и formData file (file); BearerAuth и DomainHeader. 200 возвращает AdminGameFilesResponse; 401/403 — ErrorResponse. Современный upload proposal `encounter_propose_modern_image_upload` принимает opaque imageRef от host, точные size/sha256, filename и явные poster/replaceExisting. Host связывает вложение с чатом, scope и сессией. Adapter проверяет hash локального источника, magic bytes PNG/JPG/GIF, лимит 10 MiB и ограничение игры; отправляет один multipart file. GET files проверяет новое имя/size и неизменённых соседей. Для poster:true допустимы только poster.png/jpg/gif; GET /games/{id}/details должен подтвердить game.poster_url с точным путём data/games/{id}/poster.ext. Ответ POST сам по себе не подтверждает назначение. Существующий файл требует явного replaceExisting; перезапись тем же размером отклоняется, потому что API не предоставляет удалённый hash и read-back не отличит потерянную запись от старого содержимого. Другой существующий poster.* требует отдельного решения, автоматического удаления нет. Если upload сохранён, но poster_url не подтвердился, статус остаётся unknown, повторять POST нельзя. Разрешение, доступный adapter и read-back проверяются отдельно по [административному контракту](admin-contract.md).

## Синтетический пример данных чтения

Это минимальный фрагмент, не все поля GameDetails. Значения придуманы, реальные тексты, имена, IDs, ответы и credentials из снимков не переносились.

```json
{
  "from_author_text": "<p>Синтетический анонс учебной игры</p>",
  "is_from_author_visible": true,
  "game": {
    "title": "Synthetic training game",
    "start_date_time": "2030-01-01T12:00:00Z",
    "descr": "Synthetic description",
    "poster_url": "data/games/900001/poster.png"
  }
}
```
